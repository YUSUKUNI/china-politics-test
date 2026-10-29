#!/usr/bin/env node
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT) || 0;
const indexPath = path.join(__dirname, "index.html");
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, ".data");
const databasePath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(dataDir, "results.sqlite");

const TEST_VERSION = "2026-10-29";
const CONSENT_VERSION = "2026-10-29";
const QUESTION_COUNT = 30;
const AXIS_KEYS = [
  "government",
  "income",
  "social",
  "political",
  "han",
  "culture",
  "peace",
  "west",
];
const CLIENT_COOKIE_NAME = "political_test_client";
const CLIENT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_TEST_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    result_id TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL UNIQUE,
    test_version TEXT NOT NULL,
    consent_version TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    answers_json TEXT NOT NULL,
    scores_json TEXT NOT NULL,
    percentages_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_results_created_at ON results(created_at);
`);

const findResultByClient = database.prepare(
  "SELECT result_id, created_at FROM results WHERE client_id = ?"
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
    scores_json,
    percentages_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
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

function handleClientStatus(request, response) {
  const clientId = getClientId(request);
  const existing = clientId ? findResultByClient.get(clientId) : undefined;

  sendJson(response, 200, {
    submitted: Boolean(existing),
    completedAt: existing ? existing.created_at : null,
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
  const payload = validateResultPayload(body);

  if (findResultByClient.get(clientId)) {
    sendJson(response, 409, {
      error: "duplicate_submission",
      message: "该设备已提交过结果，本次不会重复保存。",
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
      JSON.stringify(payload.scores),
      JSON.stringify(payload.percentages)
    );
  } catch (error) {
    if (error.errcode === 2067 || /UNIQUE constraint failed/.test(error.message)) {
      sendJson(response, 409, {
        error: "duplicate_submission",
        message: "该设备已提交过结果，本次不会重复保存。",
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

function validateResultPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "invalid_payload", "提交内容格式不正确。");
  }

  if (body.testVersion !== TEST_VERSION) {
    throw new HttpError(400, "version_mismatch", "测试版本不匹配，请刷新后重试。");
  }

  if (body.consent !== true || body.consentVersion !== CONSENT_VERSION) {
    throw new HttpError(400, "consent_required", "提交前必须同意匿名数据说明。");
  }

  if (
    !Array.isArray(body.answers) ||
    body.answers.length !== QUESTION_COUNT ||
    body.answers.some(
      (answer) => !Number.isInteger(answer) || answer < 0 || answer > 4
    )
  ) {
    throw new HttpError(400, "invalid_answers", "答题数据不完整或格式不正确。");
  }

  const scores = validateAxisValues(body.scores, "scores", -1000, 1000, false);
  const percentages = validateAxisValues(
    body.percentages,
    "percentages",
    -100,
    100,
    true
  );

  const startedAt = parseTimestamp(body.startedAt, "startedAt");
  const completedAt = parseTimestamp(body.completedAt, "completedAt");
  const durationMs = Number(body.durationMs);

  if (
    !Number.isFinite(durationMs) ||
    durationMs < 0 ||
    durationMs > MAX_TEST_DURATION_MS
  ) {
    throw new HttpError(400, "invalid_duration", "测试时长格式不正确。");
  }

  return {
    answers: body.answers.slice(),
    scores,
    percentages,
    startedAt,
    completedAt,
    durationMs: Math.round(durationMs),
  };
}

function validateAxisValues(value, fieldName, min, max, integerOnly) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_payload", `${fieldName} 必须是对象。`);
  }

  const result = {};
  for (const key of AXIS_KEYS) {
    const number = value[key];
    if (
      !Number.isFinite(number) ||
      number < min ||
      number > max ||
      (integerOnly && !Number.isInteger(number))
    ) {
      throw new HttpError(400, "invalid_payload", `${fieldName}.${key} 数值不合法。`);
    }
    result[key] = number;
  }
  return result;
}

function parseTimestamp(value, fieldName) {
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_timestamp", `${fieldName} 格式不正确。`);
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new HttpError(400, "invalid_timestamp", `${fieldName} 格式不正确。`);
  }
  return timestamp.toISOString();
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
  const clientId = parseCookies(request.headers.cookie)[CLIENT_COOKIE_NAME];
  return isUuid(clientId) ? clientId : null;
}

function isUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  );
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
