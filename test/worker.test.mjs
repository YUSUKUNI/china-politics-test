import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import questionnaire from "../questionnaire.js";
import worker from "../worker/index.mjs";

const ALLOWED_ORIGIN = "https://yusukuni.github.io";
const API_ORIGIN = "https://china-politics-test-api.example.workers.dev";
const ADMIN_TOKEN = "test-admin-token";

function makePayload(overrides = {}) {
  return {
    testVersion: questionnaire.meta.testVersion,
    consent: true,
    consentVersion: questionnaire.meta.consentVersion,
    answers: new Array(47).fill(2),
    startedAt: "2026-11-03T10:00:00.000Z",
    completedAt: "2026-11-03T10:08:00.000Z",
    durationMs: 480000,
    ...overrides,
  };
}

async function apiFetch(path, init = {}) {
  return worker.fetch(new Request(`${API_ORIGIN}${path}`, init), env);
}

async function submit(body, clientId, headers = {}) {
  return apiFetch("/api/results", {
    method: "POST",
    headers: {
      Origin: ALLOWED_ORIGIN,
      "Content-Type": "application/json",
      "X-Client-Id": clientId,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function readJson(response) {
  return response.json();
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM results").run();
});

describe("CORS", () => {
  it("allows the configured GitHub Pages origin", async () => {
    const response = await apiFetch("/api/results", {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-client-id",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
      "X-Client-Id"
    );
  });

  it("does not add CORS permission for unknown origins", async () => {
    const response = await apiFetch("/api/results", {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "POST",
      },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("result API", () => {
  it("stores one valid submission and reports client status", async () => {
    const clientId = crypto.randomUUID();
    const payload = makePayload();

    const before = await apiFetch("/api/client-status", {
      headers: { Origin: ALLOWED_ORIGIN, "X-Client-Id": clientId },
    });
    expect(await readJson(before)).toMatchObject({
      submitted: false,
      testVersion: questionnaire.meta.testVersion,
    });

    const created = await submit(payload, clientId);
    expect(created.status).toBe(201);
    expect(created.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);

    const row = await env.DB.prepare(
      "SELECT answers_json, scores_json, percentages_json FROM results WHERE client_id = ?"
    )
      .bind(clientId)
      .first();
    expect(JSON.parse(row.answers_json)).toEqual(payload.answers);
    expect(JSON.parse(row.scores_json)).toEqual(
      questionnaire.calculateScores(payload.answers)
    );
    expect(JSON.parse(row.percentages_json)).toEqual(
      questionnaire.calculateAxisPercentages(
        questionnaire.calculateScores(payload.answers)
      )
    );

    const after = await apiFetch("/api/client-status", {
      headers: { Origin: ALLOWED_ORIGIN, "X-Client-Id": clientId },
    });
    expect(await readJson(after)).toMatchObject({ submitted: true });
  });

  it("rejects a second submission for the same client and version", async () => {
    const clientId = crypto.randomUUID();
    expect((await submit(makePayload(), clientId)).status).toBe(201);

    const duplicate = await submit(makePayload(), clientId);
    expect(duplicate.status).toBe(409);
    expect(await readJson(duplicate)).toMatchObject({
      error: "duplicate_submission",
    });
  });

  it("allows the same client to submit after the test version changes", async () => {
    const clientId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO results (
        result_id, client_id, test_version, consent_version, started_at,
        completed_at, duration_ms, answers_json, scores_json, percentages_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        crypto.randomUUID(),
        clientId,
        "2026-10-29",
        questionnaire.meta.consentVersion,
        "2026-10-29T10:00:00.000Z",
        "2026-10-29T10:08:00.000Z",
        480000,
        JSON.stringify(new Array(47).fill(2)),
        JSON.stringify({}),
        JSON.stringify({})
      )
      .run();

    expect((await submit(makePayload(), clientId)).status).toBe(201);
  });

  it("ignores forged scores because scoring happens on the server", async () => {
    const clientId = crypto.randomUUID();
    const payload = makePayload({ scores: { government: 9999 } });
    expect((await submit(payload, clientId)).status).toBe(201);

    const row = await env.DB.prepare(
      "SELECT scores_json FROM results WHERE client_id = ?"
    )
      .bind(clientId)
      .first();
    expect(JSON.parse(row.scores_json).government).not.toBe(9999);
  });

  it.each([
    ["missing client id", makePayload(), undefined, 400],
    ["wrong version", makePayload({ testVersion: "old" }), crypto.randomUUID(), 400],
    ["missing consent", makePayload({ consent: false }), crypto.randomUUID(), 400],
    ["short answers", makePayload({ answers: [2] }), crypto.randomUUID(), 400],
    ["invalid option", makePayload({ answers: [5, ...new Array(46).fill(2)] }), crypto.randomUUID(), 400],
    ["invalid timestamp", makePayload({ startedAt: "bad" }), crypto.randomUUID(), 400],
  ])("rejects %s", async (_name, payload, clientId, expectedStatus) => {
    const response = await submit(payload, clientId);
    expect(response.status).toBe(expectedStatus);
  });

  it("rejects non-JSON content and oversized payloads", async () => {
    const clientId = crypto.randomUUID();
    const wrongType = await apiFetch("/api/results", {
      method: "POST",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Content-Type": "text/plain",
        "X-Client-Id": clientId,
      },
      body: "hello",
    });
    expect(wrongType.status).toBe(415);

    const oversized = await apiFetch("/api/results", {
      method: "POST",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Content-Type": "application/json",
        "X-Client-Id": clientId,
      },
      body: "x".repeat(70 * 1024),
    });
    expect(oversized.status).toBe(413);
  });
});

describe("admin CSV export", () => {
  it("requires the bearer token", async () => {
    const response = await apiFetch("/api/admin/results.csv", {
      headers: { Origin: ALLOWED_ORIGIN },
    });
    expect(response.status).toBe(401);
  });

  it("exports answer and axis columns", async () => {
    const clientId = crypto.randomUUID();
    expect((await submit(makePayload(), clientId)).status).toBe(201);

    const response = await apiFetch("/api/admin/results.csv", {
      headers: {
        Origin: ALLOWED_ORIGIN,
        Authorization: `Bearer ${ADMIN_TOKEN}`,
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
    const csv = await response.text();
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("score_government,percentage_government");
    expect(csv).toContain("q01");
    expect(csv).toContain("q47");
    expect(csv).toContain(clientId);
  });
});

describe("health", () => {
  it("reports the shared test version", async () => {
    const response = await apiFetch("/api/health");
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({
      ok: true,
      testVersion: questionnaire.meta.testVersion,
    });
  });
});
