#!/usr/bin/env node
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const QUESTIONNAIRE = require("./questionnaire.js");
const SURVEY30 = require("./questionnaire30.js");
const survey30Stats = require("./shared/survey30.js");
const { meta } = QUESTIONNAIRE;
const {
  HttpError,
  MAX_BODY_BYTES,
  isUuid,
  validateResultPayload: validateSubmittedResult,
  validateSurvey30Payload,
} = require("./shared/results.js");

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT) || 0;
const indexPath = path.join(__dirname, "index.html");
const questionnairePath = path.join(__dirname, "questionnaire.js");
const survey30Path = path.join(__dirname, "survey30.html");
const stats30Path = path.join(__dirname, "stats30.html");
const questionnaire30Path = path.join(__dirname, "questionnaire30.js");
const survey30ScriptPath = path.join(__dirname, "survey30.js");
const stats30ScriptPath = path.join(__dirname, "stats30.js");
const survey30StylesPath = path.join(__dirname, "survey30.css");
const stats30StylesPath = path.join(__dirname, "stats30.css");
const apiConfigPath = path.join(__dirname, "api-config.js");
const staticAssets = new Map([
  ["/survey30.html", { path: survey30Path, type: "text/html; charset=utf-8" }],
  ["/stats30.html", { path: stats30Path, type: "text/html; charset=utf-8" }],
  ["/questionnaire30.js", { path: questionnaire30Path, type: "text/javascript; charset=utf-8" }],
  ["/survey30.js", { path: survey30ScriptPath, type: "text/javascript; charset=utf-8" }],
  ["/stats30.js", { path: stats30ScriptPath, type: "text/javascript; charset=utf-8" }],
  ["/survey30.css", { path: survey30StylesPath, type: "text/css; charset=utf-8" }],
  ["/stats30.css", { path: stats30StylesPath, type: "text/css; charset=utf-8" }],
  ["/api-config.js", { path: apiConfigPath, type: "text/javascript; charset=utf-8" }],
]);
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, ".data");
const databasePath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(dataDir, "results.sqlite");

const TEST_VERSION = meta.testVersion;
const CONSENT_VERSION = meta.consentVersion;
const SURVEY30_VERSION = SURVEY30.meta.surveyVersion;
const SCHEMA_VERSION = 3;
const CLIENT_COOKIE_NAME = "political_test_client";
const CLIENT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const database = new DatabaseSync(databasePath);
initializeDatabase();

const findResultByClientAndVersion = database.prepare(
  "SELECT result_id, created_at FROM results WHERE client_id = ? AND test_version = ?"
);
const insertResult = database.prepare(`
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
`);
const findSurvey30ByClient = database.prepare(
  "SELECT result_id, created_at FROM survey30_results WHERE client_id = ? AND survey_version = ?"
);
const insertSurvey30Result = database.prepare(`
  INSERT INTO survey30_results (
    result_id,
    client_id,
    survey_version,
    consent_version,
    started_at,
    completed_at,
    duration_ms,
    answers_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

function initializeDatabase() {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
  `);

  const existingTable = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'results'")
    .get();

  if (existingTable && isLegacyResultsSchema(existingTable.sql)) {
    backupDatabase();
    migrateLegacyResultsTable();
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      result_id TEXT NOT NULL UNIQUE,
      client_id TEXT NOT NULL,
      test_version TEXT NOT NULL,
      consent_version TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      answers_json TEXT NOT NULL,
      importance_json TEXT NOT NULL DEFAULT '[]',
      scores_json TEXT NOT NULL,
      percentages_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE (client_id, test_version)
    );

    CREATE INDEX IF NOT EXISTS idx_results_created_at ON results(created_at);

    CREATE TABLE IF NOT EXISTS survey30_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      result_id TEXT NOT NULL UNIQUE,
      client_id TEXT NOT NULL,
      survey_version TEXT NOT NULL,
      consent_version TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      answers_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE (client_id, survey_version)
    );

    CREATE INDEX IF NOT EXISTS idx_survey30_results_created_at
    ON survey30_results(created_at);

    CREATE INDEX IF NOT EXISTS idx_survey30_results_version_created_at
    ON survey30_results(survey_version, created_at);

    PRAGMA user_version = ${SCHEMA_VERSION};
  `);

  ensureImportanceColumn();
}

function ensureImportanceColumn() {
  const columns = database.prepare("PRAGMA table_info(results)").all();
  if (!columns.some((column) => column.name === "importance_json")) {
    database.exec(
      "ALTER TABLE results ADD COLUMN importance_json TEXT NOT NULL DEFAULT '[]';"
    );
    console.log("已为结果表增加重要题标记字段。");
  }
}

function isLegacyResultsSchema(sql) {
  return /client_id\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(String(sql || ""));
}

function backupDatabase() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${databasePath}.pre-versioned-uniqueness-${timestamp}.bak`;
  const escapedPath = backupPath.replace(/'/g, "''");
  database.exec(`VACUUM INTO '${escapedPath}'`);
  console.log(`已备份旧数据库：${backupPath}`);
}

function migrateLegacyResultsTable() {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      DROP TABLE IF EXISTS results_v2_migration;

      CREATE TABLE results_v2_migration (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        result_id TEXT NOT NULL UNIQUE,
        client_id TEXT NOT NULL,
        test_version TEXT NOT NULL,
        consent_version TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        answers_json TEXT NOT NULL,
        importance_json TEXT NOT NULL DEFAULT '[]',
        scores_json TEXT NOT NULL,
        percentages_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE (client_id, test_version)
      );

      INSERT INTO results_v2_migration (
        id,
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
      )
      SELECT
        id,
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
      FROM results;

      DROP TABLE results;
      ALTER TABLE results_v2_migration RENAME TO results;
    `);
    database.exec("COMMIT");
    console.log("已将结果表迁移为按测试版本去重。");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
    }
    throw error;
  }
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    if (response.writableEnded) {
      return;
    }

    if (error instanceof HttpError) {
      sendJson(response, error.status, {
        error: error.code,
        message: error.message,
      });
      return;
    }

    console.error(error);
    sendJson(response, 500, {
      error: "internal_error",
      message: "服务器内部错误，请稍后重试。",
    });
  });
});

async function handleRequest(request, response) {
  const requestUrl = new URL(
    request.url || "/",
    `http://${request.headers.host || host}`
  );

  if (requestUrl.pathname === "/api/results") {
    if (request.method !== "POST") {
      throw new HttpError(405, "method_not_allowed", "仅支持 POST 请求。");
    }
    await handleResultSubmission(request, response);
    return;
  }

  if (requestUrl.pathname === "/api/client-status") {
    if (request.method !== "GET") {
      throw new HttpError(405, "method_not_allowed", "仅支持 GET 请求。");
    }
    handleClientStatus(request, response);
    return;
  }

  if (requestUrl.pathname === "/api/survey30/results") {
    if (request.method !== "POST") {
      throw new HttpError(405, "method_not_allowed", "仅支持 POST 请求。");
    }
    await handleSurvey30Submission(request, response);
    return;
  }

  if (requestUrl.pathname === "/api/survey30/client-status") {
    if (request.method !== "GET") {
      throw new HttpError(405, "method_not_allowed", "仅支持 GET 请求。");
    }
    handleSurvey30ClientStatus(request, response);
    return;
  }

  if (requestUrl.pathname === "/api/survey30/stats") {
    if (request.method !== "GET") {
      throw new HttpError(405, "method_not_allowed", "仅支持 GET 请求。");
    }
    handleSurvey30Stats(request, response);
    return;
  }

  if (requestUrl.pathname === "/questionnaire.js") {
    if (request.method !== "GET") {
      throw new HttpError(405, "method_not_allowed", "仅支持 GET 请求。");
    }
    serveQuestionnaire(response);
    return;
  }

  const asset = staticAssets.get(requestUrl.pathname);
  if (asset) {
    if (request.method !== "GET") {
      throw new HttpError(405, "method_not_allowed", "仅支持 GET 请求。");
    }
    serveStaticFile(response, asset);
    return;
  }

  if (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html") {
    if (request.method !== "GET") {
      throw new HttpError(405, "method_not_allowed", "仅支持 GET 请求。");
    }
    serveIndex(request, response);
    return;
  }

  if (requestUrl.pathname === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not Found");
}

function serveIndex(request, response) {
  fs.readFile(indexPath, (error, content) => {
    if (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("无法读取 index.html");
      return;
    }

    const clientId = getClientId(request) || crypto.randomUUID();
    response.setHeader("Set-Cookie", buildClientCookie(request, clientId));
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(content);
  });
}

function serveQuestionnaire(response) {
  fs.readFile(questionnairePath, (error, content) => {
    if (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("无法读取 questionnaire.js");
      return;
    }

    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(content);
  });
}

function serveStaticFile(response, asset) {
  fs.readFile(asset.path, (error, content) => {
    if (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("无法读取静态文件");
      return;
    }
    response.writeHead(200, {
      "Content-Type": asset.type,
      "Cache-Control": "no-store",
    });
    response.end(content);
  });
}

function handleClientStatus(request, response) {
  const clientId = getClientId(request);
  const existing = clientId
    ? findResultByClientAndVersion.get(clientId, TEST_VERSION)
    : undefined;

  sendJson(response, 200, {
    submitted: Boolean(existing),
    completedAt: existing ? existing.created_at : null,
    testVersion: TEST_VERSION,
  });
}

async function handleResultSubmission(request, response) {
  const clientId = getClientId(request);
  if (!clientId) {
    throw new HttpError(
      400,
      "missing_client_id",
      "匿名客户端标识缺失，请刷新页面后重试。"
    );
  }

  const contentType = String(request.headers["content-type"] || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpError(415, "invalid_content_type", "请求必须使用 JSON。");
  }

  const body = await readJsonBody(request);
  const payload = validateSubmittedResult(body, QUESTIONNAIRE);

  if (findResultByClientAndVersion.get(clientId, TEST_VERSION)) {
    sendJson(response, 409, {
      error: "duplicate_submission",
      message: "该设备已提交过当前版本，本次不会重复保存。",
    });
    return;
  }

  const resultId = crypto.randomUUID();

  try {
    insertResult.run(
      resultId,
      clientId,
      TEST_VERSION,
      CONSENT_VERSION,
      payload.startedAt,
      payload.completedAt,
      payload.durationMs,
      JSON.stringify(payload.answers),
      JSON.stringify(payload.importantQuestions),
      JSON.stringify(payload.scores),
      JSON.stringify(payload.percentages)
    );
  } catch (error) {
    if (error.errcode === 2067 || /UNIQUE constraint failed/.test(error.message)) {
      sendJson(response, 409, {
        error: "duplicate_submission",
        message: "该设备已提交过当前版本，本次不会重复保存。",
      });
      return;
    }
    throw error;
  }

  console.log(`Stored anonymous result ${resultId}`);
  sendJson(response, 201, {
    ok: true,
    resultId,
    message: "结果已匿名保存。",
  });
}

async function handleSurvey30Submission(request, response) {
  const clientId = getClientId(request);
  if (!clientId) {
    throw new HttpError(
      400,
      "missing_client_id",
      "匿名客户端标识缺失，请刷新页面后重试。"
    );
  }

  const contentType = String(request.headers["content-type"] || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpError(415, "invalid_content_type", "请求必须使用 JSON。");
  }

  const body = await readJsonBody(request);
  const payload = validateSurvey30Payload(body, SURVEY30);

  if (findSurvey30ByClient.get(clientId, SURVEY30_VERSION)) {
    sendJson(response, 409, {
      error: "duplicate_submission",
      message: "该设备已提交过本版调查，本次不会重复保存。",
    });
    return;
  }

  const resultId = crypto.randomUUID();

  try {
    insertSurvey30Result.run(
      resultId,
      clientId,
      SURVEY30_VERSION,
      SURVEY30.meta.consentVersion,
      payload.startedAt,
      payload.completedAt,
      payload.durationMs,
      JSON.stringify(payload.answers)
    );
  } catch (error) {
    if (error.errcode === 2067 || /UNIQUE constraint failed/.test(error.message)) {
      sendJson(response, 409, {
        error: "duplicate_submission",
        message: "该设备已提交过本版调查，本次不会重复保存。",
      });
      return;
    }
    throw error;
  }

  console.log(`Stored anonymous survey30 result ${resultId}`);
  sendJson(response, 201, {
    ok: true,
    resultId,
    surveyVersion: SURVEY30_VERSION,
    message: "答卷已匿名保存。",
  });
}

function handleSurvey30ClientStatus(request, response) {
  const clientId = getClientId(request);
  const existing = clientId
    ? findSurvey30ByClient.get(clientId, SURVEY30_VERSION)
    : undefined;

  sendJson(response, 200, {
    submitted: Boolean(existing),
    completedAt: existing ? existing.created_at : null,
    surveyVersion: SURVEY30_VERSION,
  });
}

function handleSurvey30Stats(_request, response) {
  const summary = database.prepare(`
    SELECT
      COUNT(*) AS total,
      COUNT(DISTINCT client_id) AS unique_clients,
      AVG(duration_ms) AS average_duration_ms,
      MAX(created_at) AS last_submitted_at
    FROM survey30_results
    WHERE survey_version = ?
  `).get(SURVEY30_VERSION);

  const today = database.prepare(`
    SELECT COUNT(*) AS today_count
    FROM survey30_results
    WHERE survey_version = ?
      AND date(created_at, '+8 hours') = date('now', '+8 hours')
  `).get(SURVEY30_VERSION);

  const questionCounts = survey30Stats.createEmptyQuestionCounts(SURVEY30);
  const rows = database.prepare(
    "SELECT answers_json FROM survey30_results WHERE survey_version = ?"
  ).all(SURVEY30_VERSION);
  rows.forEach((row) => {
    let answers = [];
    try {
      answers = JSON.parse(row.answers_json);
    } catch {
      return;
    }
    survey30Stats.addAnswers(questionCounts, answers, SURVEY30);
  });
  const aggregated = survey30Stats.summarizeQuestionCounts(questionCounts, SURVEY30);

  const daily = database.prepare(`
    SELECT date(created_at, '+8 hours') AS day, COUNT(*) AS count
    FROM survey30_results
    WHERE survey_version = ?
    GROUP BY date(created_at, '+8 hours')
    ORDER BY day DESC
    LIMIT 30
  `).all(SURVEY30_VERSION).reverse().map((row) => ({
    date: row.day,
    count: Number(row.count || 0),
  }));

  sendJson(response, 200, {
    generatedAt: new Date().toISOString(),
    survey: {
      title: SURVEY30.meta.title,
      edition: SURVEY30.meta.edition,
      version: SURVEY30_VERSION,
      consentVersion: SURVEY30.meta.consentVersion,
    },
    summary: {
      total: Number(summary?.total || 0),
      uniqueClients: Number(summary?.unique_clients || 0),
      todayCount: Number(today?.today_count || 0),
      averageDurationMs: summary?.average_duration_ms ?? null,
      lastSubmittedAt: summary?.last_submitted_at ?? null,
    },
    options: SURVEY30.options.map((option, index) => ({
      index,
      label: option.label,
      value: option.value,
      uncertain: Boolean(option.uncertain),
    })),
    overview: aggregated.overall,
    questions: aggregated.questions,
    daily,
  });
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  let tooLarge = false;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      tooLarge = true;
      continue;
    }
    chunks.push(chunk);
  }

  if (tooLarge) {
    throw new HttpError(413, "payload_too_large", "提交内容过大。");
  }

  if (chunks.length === 0) {
    throw new HttpError(400, "empty_body", "提交内容为空。");
  }

  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json", "JSON 格式不正确。");
  }
}

function parseCookies(header) {
  const cookies = {};
  String(header || "")
    .split(";")
    .forEach((part) => {
      const separator = part.indexOf("=");
      if (separator === -1) {
        return;
      }
      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      if (name) {
        cookies[name] = decodeURIComponent(value);
      }
    });
  return cookies;
}

function getClientId(request) {
  const headerClientId = request.headers["x-client-id"];
  if (isUuid(headerClientId)) {
    return headerClientId;
  }
  const clientId = parseCookies(request.headers.cookie)[CLIENT_COOKIE_NAME];
  return isUuid(clientId) ? clientId : null;
}

function buildClientCookie(request, clientId) {
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "");
  const secure =
    process.env.COOKIE_SECURE === "1" || forwardedProto.startsWith("https");
  return [
    `${CLIENT_COOKIE_NAME}=${encodeURIComponent(clientId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${CLIENT_COOKIE_MAX_AGE}`,
    secure ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

server.on("error", (error) => {
  console.error(`启动失败：${error.message}`);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  const address = server.address();
  const url = `http://${host}:${address.port}`;
  console.log(`数据库：${databasePath}`);
  console.log(`中国政治立场测试已启动：${url}`);
  console.log("按 Ctrl+C 停止服务。");

  if (!process.argv.includes("--no-open")) {
    openBrowser(url);
  }
});

function openBrowser(url) {
  const commands = {
    win32: { command: "cmd", args: ["/c", "start", "", url] },
    darwin: { command: "open", args: [url] },
    linux: { command: "xdg-open", args: [url] },
  };
  const entry = commands[process.platform];

  if (!entry) {
    return;
  }

  const child = spawn(entry.command, entry.args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.on("error", () => {});
  child.unref();
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  server.close(() => {
    database.close();
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 5000).unref();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, shutdown);
}
