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
    scores_json,
    percentages_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

async function handleAdminCsv(request, env, allowedOrigin) {
  if (request.method !== "GET") {
    return methodNotAllowed("GET", allowedOrigin);
  }

  const expectedToken = String(env.ADMIN_EXPORT_TOKEN || "");
  if (!expectedToken) {
    throw new HttpError(
      503,
      "admin_export_not_configured",
      "管理导出尚未配置，请先设置 ADMIN_EXPORT_TOKEN。"
    );
  }

  const suppliedToken = getBearerToken(request);
  if (!suppliedToken || !(await secureEqual(suppliedToken, expectedToken))) {
    return jsonResponse(
      401,
      {
        error: "unauthorized",
        message: "管理令牌无效。",
      },
      allowedOrigin,
      { "WWW-Authenticate": 'Bearer realm="results"' }
    );
  }

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
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
    return finalizeResponse(
      jsonResponse(
        error.status,
        {
          error: error.code,
          message: error.message,
        },
        allowedOrigin
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
