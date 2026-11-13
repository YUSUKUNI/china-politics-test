import questionnaire from "../questionnaire.js";
import resultUtils from "../shared/results.js";

const {
  MAX_BODY_BYTES,
  CSV_BOM,
  HttpError,
  isUuid,
  validateResultPayload,
  buildCsvHeader,
  buildCsvRecord,
} = resultUtils;

const TEST_VERSION = questionnaire.meta.testVersion;
const PAGE_SIZE = 500;
const DASHBOARD_DEFAULT_PAGE_SIZE = 20;
const DASHBOARD_MAX_PAGE_SIZE = 100;
const INSERT_RESULT_SQL = `
  INSERT INTO results (
    result_id,
    client_id,
    test_version,
    consent_version,
    started_at,
    completed_at,
    duration_ms,
    answers_json,
    importance_json,
    scores_json,
    percentages_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
const SELECT_RESULT_BY_CLIENT_SQL = `
  SELECT created_at
  FROM results
  WHERE client_id = ? AND test_version = ?
`;
const SELECT_RESULTS_PAGE_SQL = `
  SELECT
    result_id,
    client_id,
    test_version,
    consent_version,
    started_at,
    completed_at,
    duration_ms,
    answers_json,
    importance_json,
    scores_json,
    percentages_json,
    created_at
  FROM results
  ORDER BY id
  LIMIT ? OFFSET ?
`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const requestOrigin = request.headers.get("Origin");
    const allowedOrigin = getAllowedOrigin(requestOrigin, env);

    if (requestOrigin && !allowedOrigin) {
      return jsonResponse(403, {
        error: "origin_not_allowed",
        message: "当前来源不允许访问该接口。",
      });
    }

    if (request.method === "OPTIONS") {
      return optionsResponse(allowedOrigin);
    }

    try {
      let response;

      if (url.pathname === "/api/results") {
        response = await handleResults(request, env, allowedOrigin);
      } else if (url.pathname === "/api/client-status") {
        response = await handleClientStatus(request, env, allowedOrigin);
      } else if (url.pathname === "/api/admin/results") {
        response = await handleAdminDashboard(request, env, allowedOrigin, url);
      } else if (/^\/api\/admin\/results\/[^/]+$/.test(url.pathname)) {
        response = await handleAdminDelete(
          request,
          env,
          allowedOrigin,
          url.pathname.slice("/api/admin/results/".length)
        );
      } else if (url.pathname === "/api/admin/results.csv") {
        response = await handleAdminCsv(request, env, allowedOrigin);
      } else if (url.pathname === "/api/health") {
        response = await handleHealth(request, env, allowedOrigin);
      } else {
        response = jsonResponse(404, {
          error: "not_found",
          message: "接口不存在。",
        }, allowedOrigin);
      }

      return finalizeResponse(response, allowedOrigin);
    } catch (error) {
      return errorResponse(error, allowedOrigin);
    }
  },
};

async function handleResults(request, env, allowedOrigin) {
  if (request.method !== "POST") {
    return methodNotAllowed("POST", allowedOrigin);
  }

  const clientId = getClientId(request);
  if (!clientId) {
    throw new HttpError(
      400,
      "missing_client_id",
      "匿名客户端标识缺失，请刷新页面后重试。"
    );
  }

  const contentType = String(request.headers.get("Content-Type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpError(415, "invalid_content_type", "请求必须使用 JSON。");
  }

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "payload_too_large", "提交内容过大。");
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "payload_too_large", "提交内容过大。");
  }
  if (!rawBody.trim()) {
    throw new HttpError(400, "empty_body", "提交内容为空。");
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new HttpError(400, "invalid_json", "JSON 格式不正确。");
  }

  const payload = validateResultPayload(body, questionnaire);
  const resultId = crypto.randomUUID();

  try {
    await env.DB.prepare(INSERT_RESULT_SQL)
      .bind(
        resultId,
        clientId,
        TEST_VERSION,
        questionnaire.meta.consentVersion,
        payload.startedAt,
        payload.completedAt,
        payload.durationMs,
        JSON.stringify(payload.answers),
        JSON.stringify(payload.importantQuestions),
        JSON.stringify(payload.scores),
        JSON.stringify(payload.percentages)
      )
      .run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return jsonResponse(
        409,
        {
          error: "duplicate_submission",
          message: "该设备已提交过当前版本，本次不会重复保存。",
        },
        allowedOrigin
      );
    }
    throw error;
  }

  console.log(`Stored anonymous result ${resultId}`);
  return jsonResponse(
    201,
    {
      ok: true,
      resultId,
      message: "结果已匿名保存。",
    },
    allowedOrigin
  );
}

async function handleClientStatus(request, env, allowedOrigin) {
  if (request.method !== "GET") {
    return methodNotAllowed("GET", allowedOrigin);
  }

  const clientId = getClientId(request);
  if (!clientId) {
    throw new HttpError(
      400,
      "missing_client_id",
      "匿名客户端标识缺失，请刷新页面后重试。"
    );
  }

  const existing = await env.DB.prepare(SELECT_RESULT_BY_CLIENT_SQL)
    .bind(clientId, TEST_VERSION)
    .first();

  return jsonResponse(
    200,
    {
      submitted: Boolean(existing),
      completedAt: existing ? existing.created_at : null,
      testVersion: TEST_VERSION,
    },
    allowedOrigin
  );
}

async function handleAdminDashboard(request, env, allowedOrigin, url) {
  if (request.method !== "GET") {
    return methodNotAllowed("GET", allowedOrigin);
  }

  await assertAdminAccess(request, env);
  const filters = parseAdminFilters(url);
  const dashboard = await loadAdminDashboard(env.DB, filters);
  return jsonResponse(200, dashboard, allowedOrigin);
}

async function handleAdminDelete(request, env, allowedOrigin, encodedResultId) {
  if (request.method !== "DELETE") {
    return methodNotAllowed("DELETE", allowedOrigin);
  }

  await assertAdminAccess(request, env);

  let resultId;
  try {
    resultId = decodeURIComponent(encodedResultId);
  } catch {
    throw new HttpError(400, "invalid_result_id", "答卷 ID 格式不正确。");
  }
  if (!isUuid(resultId)) {
    throw new HttpError(400, "invalid_result_id", "答卷 ID 格式不正确。");
  }

  const result = await env.DB.prepare(
    "DELETE FROM results WHERE result_id = ?"
  )
    .bind(resultId)
    .run();

  if (Number(result.meta?.changes || 0) === 0) {
    throw new HttpError(404, "result_not_found", "未找到该答卷，可能已被删除。");
  }

  console.log(`Deleted anonymous result ${resultId}`);
  return jsonResponse(
    200,
    {
      ok: true,
      resultId,
      message: "答卷已删除，统计已重新计算。",
    },
    allowedOrigin
  );
}

async function handleAdminCsv(request, env, allowedOrigin) {
  if (request.method !== "GET") {
    return methodNotAllowed("GET", allowedOrigin);
  }

  await assertAdminAccess(request, env);

  let offset = 0;
  let csv = `${buildCsvHeader(questionnaire)}\r\n`;

  while (true) {
    const page = await env.DB.prepare(SELECT_RESULTS_PAGE_SQL)
      .bind(PAGE_SIZE, offset)
      .all();
    const rows = Array.isArray(page.results) ? page.results : [];

    rows.forEach((row) => {
      csv += `${buildCsvRecord(row, questionnaire)}\r\n`;
    });

    if (rows.length < PAGE_SIZE) {
      break;
    }
    offset += rows.length;
  }

  const filename = `china-politics-results-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;
  return new Response(`${CSV_BOM}${csv}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

async function assertAdminAccess(request, env) {
  const expectedToken = String(env.ADMIN_EXPORT_TOKEN || "");
  if (!expectedToken) {
    throw new HttpError(
      503,
      "admin_export_not_configured",
      "管理后台尚未配置，请先设置 ADMIN_EXPORT_TOKEN。"
    );
  }

  const suppliedToken = getBearerToken(request);
  if (!suppliedToken || !(await secureEqual(suppliedToken, expectedToken))) {
    throw new HttpError(401, "unauthorized", "管理令牌无效。");
  }
}

function parseAdminFilters(url) {
  const page = parseBoundedInteger(
    url.searchParams.get("page"),
    1,
    1,
    1_000_000,
    "page"
  );
  const pageSize = parseBoundedInteger(
    url.searchParams.get("pageSize"),
    DASHBOARD_DEFAULT_PAGE_SIZE,
    1,
    DASHBOARD_MAX_PAGE_SIZE,
    "pageSize"
  );
  const version = String(url.searchParams.get("version") || "").trim();
  const search = String(url.searchParams.get("q") || "").trim();

  if (version.length > 80) {
    throw new HttpError(400, "invalid_filter", "版本筛选值过长。");
  }
  if (search.length > 100) {
    throw new HttpError(400, "invalid_filter", "搜索内容过长。");
  }

  const from = parseChinaDateFilter(url.searchParams.get("from"), "开始日期");
  const to = parseChinaDateFilter(url.searchParams.get("to"), "结束日期");
  if (from && to && from.date > to.date) {
    throw new HttpError(400, "invalid_filter", "开始日期不能晚于结束日期。");
  }

  return { page, pageSize, version, search, from, to };
}

function parseBoundedInteger(value, fallback, min, max, fieldName) {
  if (value === null || value === "") {
    return fallback;
  }
  if (!/^\d+$/.test(String(value))) {
    throw new HttpError(400, "invalid_filter", `${fieldName} 必须是正整数。`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new HttpError(
      400,
      "invalid_filter",
      `${fieldName} 必须位于 ${min} 到 ${max} 之间。`
    );
  }
  return parsed;
}

function parseChinaDateFilter(value, fieldName) {
  if (!value) {
    return null;
  }
  const dateText = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    throw new HttpError(400, "invalid_filter", `${fieldName} 格式应为 YYYY-MM-DD。`);
  }
  const startMs = Date.parse(`${dateText}T00:00:00+08:00`);
  if (!Number.isFinite(startMs)) {
    throw new HttpError(400, "invalid_filter", `${fieldName} 不是有效日期。`);
  }
  const normalized = formatChinaDate(new Date(startMs));
  if (normalized !== dateText) {
    throw new HttpError(400, "invalid_filter", `${fieldName} 不是有效日期。`);
  }
  return {
    date: dateText,
    startUtc: new Date(startMs).toISOString(),
    endUtc: new Date(startMs + 24 * 60 * 60 * 1000).toISOString(),
  };
}

function formatChinaDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function buildResultFilter(filters, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  const conditions = [];
  const params = [];

  if (filters.version) {
    conditions.push(`${prefix}test_version = ?`);
    params.push(filters.version);
  }
  if (filters.from) {
    conditions.push(`${prefix}created_at >= ?`);
    params.push(filters.from.startUtc);
  }
  if (filters.to) {
    conditions.push(`${prefix}created_at < ?`);
    params.push(filters.to.endUtc);
  }
  if (filters.search) {
    conditions.push(
      `(instr(${prefix}result_id, ?) > 0 OR instr(${prefix}client_id, ?) > 0)`
    );
    params.push(filters.search, filters.search);
  }

  return {
    sql: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

function bindOptional(statement, params) {
  return params.length ? statement.bind(...params) : statement;
}

async function loadAdminDashboard(db, filters) {
  const baseFilter = buildResultFilter(filters);
  const aliasFilter = buildResultFilter(filters, "r");
  const axisSelects = questionnaire.axes
    .map((axis) => {
      const path = `'$.${axis.key}'`;
      return [
        `ROUND(AVG(json_extract(r.percentages_json, ${path})), 1) AS avg_${axis.key}`,
        `ROUND(MIN(json_extract(r.percentages_json, ${path})), 1) AS min_${axis.key}`,
        `ROUND(MAX(json_extract(r.percentages_json, ${path})), 1) AS max_${axis.key}`,
      ].join(", ");
    })
    .join(",\n");
  const importanceConditions = ["j.value = 1"];
  if (aliasFilter.sql) {
    importanceConditions.push(aliasFilter.sql.replace(/^WHERE /, ""));
  }
  const importanceWhere = `WHERE ${importanceConditions.join(" AND ")}`;
  const today = parseChinaDateFilter(formatChinaDate(new Date()), "今天");

  const summaryPromise = bindOptional(
    db.prepare(`
      SELECT
        COUNT(*) AS total,
        COUNT(DISTINCT client_id) AS unique_clients,
        ROUND(AVG(duration_ms)) AS average_duration_ms,
        MAX(created_at) AS last_submitted_at
      FROM results
      ${baseFilter.sql}
    `),
    baseFilter.params
  ).first();

  const todayPromise = db
    .prepare(`
      SELECT COUNT(*) AS today_count
      FROM results
      WHERE created_at >= ? AND created_at < ?
    `)
    .bind(today.startUtc, today.endUtc)
    .first();

  const importancePromise = bindOptional(
    db.prepare(`
      SELECT COUNT(*) AS importance_marks
      FROM results r, json_each(r.importance_json) AS j
      ${importanceWhere}
    `),
    aliasFilter.params
  ).first();

  const axisPromise = bindOptional(
    db.prepare(`
      SELECT ${axisSelects}
      FROM results r
      ${aliasFilter.sql}
    `),
    aliasFilter.params
  ).first();

  const topImportancePromise = bindOptional(
    db.prepare(`
      SELECT CAST(j.key AS INTEGER) AS question_index, COUNT(*) AS count
      FROM results r, json_each(r.importance_json) AS j
      ${importanceWhere}
      GROUP BY CAST(j.key AS INTEGER)
      ORDER BY count DESC, question_index ASC
      LIMIT 10
    `),
    aliasFilter.params
  ).all();

  const dailyPromise = bindOptional(
    db.prepare(`
      SELECT date(r.created_at, '+8 hours') AS day, COUNT(*) AS count
      FROM results r
      ${aliasFilter.sql}
      GROUP BY date(r.created_at, '+8 hours')
      ORDER BY day DESC
      LIMIT 30
    `),
    aliasFilter.params
  ).all();

  const versionsPromise = db
    .prepare(`
      SELECT test_version AS version, COUNT(*) AS count, MAX(created_at) AS last_submitted_at
      FROM results
      GROUP BY test_version
      ORDER BY test_version DESC
    `)
    .all();

  const [
    summary,
    todayCount,
    importanceSummary,
    axisSummary,
    topImportance,
    dailyRows,
    versionRows,
  ] = await Promise.all([
    summaryPromise,
    todayPromise,
    importancePromise,
    axisPromise,
    topImportancePromise,
    dailyPromise,
    versionsPromise,
  ]);

  const total = Number(summary?.total || 0);
  const pageCount = Math.max(1, Math.ceil(total / filters.pageSize));
  const page = Math.min(filters.page, pageCount);
  const offset = (page - 1) * filters.pageSize;

  const pageStatement = db.prepare(`
    SELECT
      result_id,
      client_id,
      test_version,
      consent_version,
      started_at,
      completed_at,
      duration_ms,
      answers_json,
      importance_json,
      scores_json,
      percentages_json,
      created_at
    FROM results r
    ${aliasFilter.sql}
    ORDER BY r.id DESC
    LIMIT ? OFFSET ?
  `);
  const pageResult = await pageStatement
    .bind(...aliasFilter.params, filters.pageSize, offset)
    .all();

  const results = (pageResult.results || []).map((row) => {
    const importantQuestions = parseJsonValue(row.importance_json, []);
    return {
      resultId: row.result_id,
      clientId: row.client_id,
      testVersion: row.test_version,
      consentVersion: row.consent_version,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      durationMs: row.duration_ms,
      createdAt: row.created_at,
      importanceCount: importantQuestions.filter((value) => value === true).length,
      answers: parseJsonValue(row.answers_json, []),
      importantQuestions,
      scores: parseJsonValue(row.scores_json, {}),
      percentages: parseJsonValue(row.percentages_json, {}),
    };
  });

  const topImportanceRows = topImportance.results || [];
  const axes = questionnaire.axes.map((axis) => ({
    key: axis.key,
    name: axis.name,
    left: axis.left,
    right: axis.right,
    averagePercentage: axisSummary?.[`avg_${axis.key}`] ?? null,
    minPercentage: axisSummary?.[`min_${axis.key}`] ?? null,
    maxPercentage: axisSummary?.[`max_${axis.key}`] ?? null,
  }));

  return {
    generatedAt: new Date().toISOString(),
    testVersion: TEST_VERSION,
    summary: {
      total,
      uniqueClients: Number(summary?.unique_clients || 0),
      todayCount: Number(todayCount?.today_count || 0),
      averageDurationMs: summary?.average_duration_ms ?? null,
      lastSubmittedAt: summary?.last_submitted_at ?? null,
      importanceMarks: Number(importanceSummary?.importance_marks || 0),
      axes,
      daily: (dailyRows.results || []).slice().reverse().map((row) => ({
        date: row.day,
        count: Number(row.count || 0),
      })),
      topImportantQuestions: topImportanceRows.map((row) => {
        const questionIndex = Number(row.question_index);
        const question = questionnaire.questions[questionIndex];
        return {
          questionNumber: questionIndex + 1,
          text: question ? question.text : `第 ${questionIndex + 1} 题`,
          count: Number(row.count || 0),
          share: total ? Math.round((Number(row.count || 0) / total) * 1000) / 10 : 0,
        };
      }),
      versions: (versionRows.results || []).map((row) => ({
        version: row.version,
        count: Number(row.count || 0),
        lastSubmittedAt: row.last_submitted_at,
      })),
    },
    filters: {
      page,
      pageSize: filters.pageSize,
      version: filters.version,
      from: filters.from?.date || "",
      to: filters.to?.date || "",
      q: filters.search,
    },
    pagination: {
      page,
      pageSize: filters.pageSize,
      total,
      pageCount,
    },
    results,
  };
}

function parseJsonValue(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function handleHealth(request, env, allowedOrigin) {
  if (request.method !== "GET") {
    return methodNotAllowed("GET", allowedOrigin);
  }

  await env.DB.prepare("SELECT 1 AS ok").first();
  return jsonResponse(
    200,
    {
      ok: true,
      testVersion: TEST_VERSION,
    },
    allowedOrigin
  );
}

function getAllowedOrigin(origin, env) {
  if (!origin) {
    return "";
  }

  const configuredOrigins = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return configuredOrigins.includes(origin) ? origin : null;
}

function getClientId(request) {
  const clientId = request.headers.get("X-Client-Id");
  return isUuid(clientId) ? clientId : null;
}

function getBearerToken(request) {
  const authorization = String(request.headers.get("Authorization") || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function secureEqual(left, right) {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

function isUniqueConstraintError(error) {
  const message = error && error.message ? error.message : String(error || "");
  return /UNIQUE constraint failed/i.test(message);
}

function methodNotAllowed(method, allowedOrigin) {
  return jsonResponse(
    405,
    {
      error: "method_not_allowed",
      message: `仅支持 ${method} 请求。`,
    },
    allowedOrigin,
    { Allow: method }
  );
}

function jsonResponse(status, payload, allowedOrigin, additionalHeaders = {}) {
  const headers = new Headers(additionalHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  if (allowedOrigin) {
    applyCorsHeaders(headers, allowedOrigin);
  }
  return new Response(JSON.stringify(payload), { status, headers });
}

function applyCorsHeaders(headers, allowedOrigin) {
  headers.set("Access-Control-Allow-Origin", allowedOrigin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Client-Id, Authorization"
  );
  headers.set("Access-Control-Expose-Headers", "Content-Disposition");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Vary", "Origin");
}

function optionsResponse(allowedOrigin) {
  const headers = new Headers();
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  if (allowedOrigin) {
    applyCorsHeaders(headers, allowedOrigin);
  }
  return new Response(null, { status: 204, headers });
}

function finalizeResponse(response, allowedOrigin) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  if (allowedOrigin) {
    applyCorsHeaders(headers, allowedOrigin);
  }
  return new Response(response.body, { status: response.status, headers });
}

function errorResponse(error, allowedOrigin) {
  if (error instanceof HttpError) {
    const additionalHeaders =
      error.status === 401 ? { "WWW-Authenticate": 'Bearer realm="results"' } : {};
    return finalizeResponse(
      jsonResponse(
        error.status,
        {
          error: error.code,
          message: error.message,
        },
        allowedOrigin,
        additionalHeaders
      ),
      allowedOrigin
    );
  }

  console.error(error);
  return finalizeResponse(
    jsonResponse(
      500,
      {
        error: "internal_error",
        message: "服务器内部错误，请稍后重试。",
      },
      allowedOrigin
    ),
    allowedOrigin
  );
}
