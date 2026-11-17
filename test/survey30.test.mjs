import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import survey30 from "../questionnaire30.js";
import resultUtils from "../shared/results.js";
import survey30Stats from "../shared/survey30.js";
import worker from "../worker/index.mjs";

const {
  validateSurvey30Payload,
  buildSurvey30CsvHeader,
  buildSurvey30CsvRecord,
  buildSurvey30CsvDocument,
} = resultUtils;

const ALLOWED_ORIGIN = "https://yusukuni.github.io";
const API_ORIGIN = "https://china-politics-test-api.example.workers.dev";
const ADMIN_TOKEN = "test-admin-token";

function makeSurvey30Payload(overrides = {}) {
  return {
    surveyVersion: survey30.meta.surveyVersion,
    consent: true,
    consentVersion: survey30.meta.consentVersion,
    answers: new Array(30).fill(0),
    startedAt: "2026-11-17T10:00:00.000Z",
    completedAt: "2026-11-17T10:06:00.000Z",
    durationMs: 360000,
    ...overrides,
  };
}

async function apiFetch(path, init = {}) {
  return worker.fetch(new Request(`${API_ORIGIN}${path}`, init), env);
}

async function submitSurvey30(body, clientId) {
  return apiFetch("/api/survey30/results", {
    method: "POST",
    headers: {
      Origin: ALLOWED_ORIGIN,
      "Content-Type": "application/json",
      ...(clientId ? { "X-Client-Id": clientId } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("survey30 questionnaire", () => {
  it("contains 30 questions and six answer options", () => {
    expect(survey30.questions).toHaveLength(30);
    expect(survey30.options).toHaveLength(6);
    expect(survey30.meta.surveyVersion).toBe("2026-11-17");
    expect(survey30.options[5].label).toBe("不确定 / 不愿回答");
  });

  it("validates a complete anonymous submission", () => {
    const payload = validateSurvey30Payload(
      makeSurvey30Payload({ forgedScore: 9999 }),
      survey30
    );
    expect(payload.answers).toEqual(new Array(30).fill(0));
    expect(payload).not.toHaveProperty("forgedScore");
  });

  it.each([
    ["wrong version", { surveyVersion: "old" }, "version_mismatch"],
    ["missing consent", { consent: false }, "consent_required"],
    ["short answers", { answers: [0] }, "invalid_answers"],
    ["invalid answer index", { answers: [6, ...new Array(29).fill(0)] }, "invalid_answers"],
    ["negative answer", { answers: [-1, ...new Array(29).fill(0)] }, "invalid_answers"],
    ["invalid timestamp", { startedAt: "not-a-date" }, "invalid_timestamp"],
    ["negative duration", { durationMs: -1 }, "invalid_duration"],
  ])("rejects %s", (_name, overrides, code) => {
    try {
      validateSurvey30Payload(makeSurvey30Payload(overrides), survey30);
      throw new Error("Expected validation to fail.");
    } catch (error) {
      expect(error.code).toBe(code);
    }
  });

  it("builds a CSV with all 30 answers", () => {
    const answers = Array.from({ length: 30 }, (_value, index) => index % 6);
    const record = {
      result_id: "result-30",
      client_id: "client-30",
      survey_version: survey30.meta.surveyVersion,
      consent_version: survey30.meta.consentVersion,
      started_at: "2026-11-17T10:00:00.000Z",
      completed_at: "2026-11-17T10:06:00.000Z",
      duration_ms: 360000,
      answers_json: JSON.stringify(answers),
      created_at: "2026-11-17T10:06:01.000Z",
    };
    const header = buildSurvey30CsvHeader(survey30);
    const row = buildSurvey30CsvRecord(record, survey30);
    const document = buildSurvey30CsvDocument([record], survey30);

    expect(header.split(",")).toHaveLength(38);
    expect(header).toContain("q01");
    expect(header).toContain("q30");
    expect(row.split(",")[8]).toBe("0");
    expect(row.split(",").at(-1)).toBe("5");
    expect(document.startsWith("\uFEFF")).toBe(true);
  });

  it("aggregates question-level distributions without counting uncertain as decided", () => {
    const counts = survey30Stats.createEmptyQuestionCounts(survey30);
    survey30Stats.addAnswers(counts, [0, ...new Array(29).fill(1)], survey30);
    survey30Stats.addAnswers(counts, [4, ...new Array(29).fill(5)], survey30);
    const summary = survey30Stats.summarizeQuestionCounts(counts, survey30);
    const first = summary.questions[0];

    expect(first.optionCounts).toEqual([1, 0, 0, 0, 1, 0]);
    expect(first.supportPercentage).toBe(50);
    expect(first.opposePercentage).toBe(50);
    expect(first.netSupportIndex).toBe(0);
    expect(summary.questions[1].uncertainCount).toBe(1);
    expect(summary.questions[1].decidedCount).toBe(1);
  });
});

describe("survey30 API", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM survey30_results").run();
  });

  it("stores a valid submission and reports client status", async () => {
    const clientId = crypto.randomUUID();
    const created = await submitSurvey30(makeSurvey30Payload(), clientId);
    expect(created.status).toBe(201);
    expect(created.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);

    const row = await env.DB.prepare(
      "SELECT answers_json FROM survey30_results WHERE client_id = ?"
    )
      .bind(clientId)
      .first();
    expect(JSON.parse(row.answers_json)).toEqual(new Array(30).fill(0));

    const status = await apiFetch("/api/survey30/client-status", {
      headers: { Origin: ALLOWED_ORIGIN, "X-Client-Id": clientId },
    });
    expect(await status.json()).toMatchObject({ submitted: true });
  });

  it("rejects duplicate submissions for the same client and version", async () => {
    const clientId = crypto.randomUUID();
    expect((await submitSurvey30(makeSurvey30Payload(), clientId)).status).toBe(201);
    const duplicate = await submitSurvey30(makeSurvey30Payload(), clientId);
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({
      error: "duplicate_submission",
    });
  });

  it("publishes only aggregate statistics", async () => {
    const clientId = crypto.randomUUID();
    const answers = Array.from({ length: 30 }, () => 0);
    await submitSurvey30(makeSurvey30Payload({ answers }), clientId);

    const response = await apiFetch("/api/survey30/stats", {
      headers: { Origin: ALLOWED_ORIGIN },
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.summary.total).toBe(1);
    expect(data.questions).toHaveLength(30);
    expect(data.questions[0].supportPercentage).toBe(100);
    expect(JSON.stringify(data)).not.toContain(clientId);
  });

  it("rejects incomplete and unauthorised submissions", async () => {
    expect((await submitSurvey30(makeSurvey30Payload(), undefined)).status).toBe(400);
    expect(
      (
        await submitSurvey30(
          makeSurvey30Payload({ answers: new Array(29).fill(0) }),
          crypto.randomUUID()
        )
      ).status
    ).toBe(400);
  });

  it("protects the survey30 CSV export with the admin token", async () => {
    const clientId = crypto.randomUUID();
    await submitSurvey30(makeSurvey30Payload(), clientId);

    const denied = await apiFetch("/api/admin/survey30/results.csv", {
      headers: { Origin: ALLOWED_ORIGIN },
    });
    expect(denied.status).toBe(401);

    const allowed = await apiFetch("/api/admin/survey30/results.csv", {
      headers: {
        Origin: ALLOWED_ORIGIN,
        Authorization: `Bearer ${ADMIN_TOKEN}`,
      },
    });
    expect(allowed.status).toBe(200);
    const csv = await allowed.text();
    expect(csv).toContain("q01");
    expect(csv).toContain("q30");
    expect(csv).toContain(clientId);
  });
});
