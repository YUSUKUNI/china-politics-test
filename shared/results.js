(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.POLITICS_RESULT_UTILS = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_BODY_BYTES = 64 * 1024;
  const MAX_TEST_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
  const CSV_BOM = "\uFEFF";
  const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  class HttpError extends Error {
    constructor(status, code, message) {
      super(message);
      this.name = "HttpError";
      this.status = status;
      this.code = code;
    }
  }

  function isUuid(value) {
    return typeof value === "string" && UUID_PATTERN.test(value);
  }

  function parseTimestamp(value, fieldName) {
    if (typeof value !== "string" || !value.trim()) {
      throw new HttpError(400, "invalid_timestamp", `${fieldName} 格式不正确。`);
    }

    const timestamp = new Date(value);
    if (Number.isNaN(timestamp.getTime())) {
      throw new HttpError(400, "invalid_timestamp", `${fieldName} 格式不正确。`);
    }
    return timestamp.toISOString();
  }

  function validateResultPayload(body, questionnaire) {
    if (!questionnaire || !questionnaire.meta || !Array.isArray(questionnaire.questions)) {
      throw new TypeError("A complete questionnaire is required.");
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "invalid_payload", "提交内容格式不正确。");
    }

    const { meta, options, questions, calculateScores, calculateAxisPercentages } =
      questionnaire;

    if (body.testVersion !== meta.testVersion) {
      throw new HttpError(400, "version_mismatch", "测试版本不匹配，请刷新后重试。");
    }

    if (body.consent !== true || body.consentVersion !== meta.consentVersion) {
      throw new HttpError(400, "consent_required", "提交前必须同意匿名数据说明。");
    }

    if (
      !Array.isArray(body.answers) ||
      body.answers.length !== questions.length ||
      body.answers.some(
        (answer) =>
          !Number.isInteger(answer) || answer < 0 || answer >= options.length
      )
    ) {
      throw new HttpError(400, "invalid_answers", "答题数据不完整或格式不正确。");
    }

    const answers = body.answers.slice();
    const scores = calculateScores(answers);
    const percentages = calculateAxisPercentages(scores);
    const startedAt = parseTimestamp(body.startedAt, "startedAt");
    const completedAt = parseTimestamp(body.completedAt, "completedAt");
    const elapsedMs = Date.parse(completedAt) - Date.parse(startedAt);

    if (elapsedMs < 0 || elapsedMs > MAX_TEST_DURATION_MS) {
      throw new HttpError(
        400,
        "invalid_timestamp",
        "结束时间必须晚于开始时间，且测试时长不能超过七天。"
      );
    }

    const durationMs = Number(body.durationMs);
    if (
      !Number.isFinite(durationMs) ||
      durationMs < 0 ||
      durationMs > MAX_TEST_DURATION_MS
    ) {
      throw new HttpError(400, "invalid_duration", "测试时长格式不正确。");
    }

    return {
      testVersion: meta.testVersion,
      consentVersion: meta.consentVersion,
      answers,
      scores,
      percentages,
      startedAt,
      completedAt,
      durationMs: Math.round(durationMs),
    };
  }

  function csvCell(value) {
    const text = value === null || value === undefined ? "" : String(value);
    if (/[",\r\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  function buildCsvHeader(questionnaire) {
    const headers = [
      "result_id",
      "client_id",
      "test_version",
      "consent_version",
      "started_at",
      "completed_at",
      "duration_ms",
      "created_at",
    ];

    questionnaire.axes.forEach((axis) => {
      headers.push(`score_${axis.key}`, `percentage_${axis.key}`);
    });

    questionnaire.questions.forEach((_question, index) => {
      headers.push(`q${String(index + 1).padStart(2, "0")}`);
    });

    return headers.join(",");
  }

  function parseStoredJson(value, fallback) {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function buildCsvRecord(record, questionnaire) {
    const scores = parseStoredJson(record.scores_json, {});
    const percentages = parseStoredJson(record.percentages_json, {});
    const answers = parseStoredJson(record.answers_json, []);
    const fields = [
      record.result_id,
      record.client_id,
      record.test_version,
      record.consent_version,
      record.started_at,
      record.completed_at,
      record.duration_ms,
      record.created_at,
    ];

    questionnaire.axes.forEach((axis) => {
      fields.push(scores[axis.key], percentages[axis.key]);
    });

    questionnaire.questions.forEach((_question, index) => {
      fields.push(Number.isInteger(answers[index]) ? answers[index] : "");
    });

    return fields.map(csvCell).join(",");
  }

  function buildCsvDocument(records, questionnaire) {
    const lines = [buildCsvHeader(questionnaire)];
    records.forEach((record) => {
      lines.push(buildCsvRecord(record, questionnaire));
    });
    return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
  }

  return {
    MAX_BODY_BYTES,
    MAX_TEST_DURATION_MS,
    CSV_BOM,
    HttpError,
    isUuid,
    validateResultPayload,
    buildCsvHeader,
    buildCsvRecord,
    buildCsvDocument,
  };
});
