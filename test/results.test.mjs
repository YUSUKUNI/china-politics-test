import { describe, expect, it } from "vitest";
import questionnaire from "../questionnaire.js";
import resultUtils from "../shared/results.js";

const {
  validateResultPayload,
  buildCsvHeader,
  buildCsvRecord,
  buildCsvDocument,
  isUuid,
} = resultUtils;

function makePayload(overrides = {}) {
  return {
    testVersion: questionnaire.meta.testVersion,
    consent: true,
    consentVersion: questionnaire.meta.consentVersion,
    answers: new Array(questionnaire.questions.length).fill(2),
    importantQuestions: new Array(questionnaire.questions.length).fill(false),
    startedAt: "2026-11-10T10:00:00.000Z",
    completedAt: "2026-11-10T10:08:00.000Z",
    durationMs: 480000,
    ...overrides,
  };
}

describe("questionnaire and result validation", () => {
  it("keeps the current 60-question version", () => {
    expect(questionnaire.questions).toHaveLength(60);
    expect(questionnaire.axes).toHaveLength(8);
    expect(questionnaire.meta.testVersion).toBe("2026-11-13.1");
    expect(questionnaire.meta.importanceMultiplier).toBe(1.5);
    expect(questionnaire.axes.map((axis) => axis.key)).toEqual([
      "government",
      "income",
      "social",
      "political",
      "han",
      "peace",
      "west",
      "gender",
    ]);
  });

  it("uses the revised national-culture and gender axis labels", () => {
    const cultureAxis = questionnaire.axes.find((axis) => axis.key === "han");
    const genderAxis = questionnaire.axes.find((axis) => axis.key === "gender");

    expect(cultureAxis).toMatchObject({
      name: "民族文化",
      left: "多元民族文化",
      right: "汉民族文化",
    });
    expect(genderAxis).toMatchObject({
      name: "性别立场",
      left: "利男",
      right: "利女",
    });
  });

  it("recalculates scores and ignores client-supplied scores", () => {
    const payload = makePayload({ scores: { government: 9999 } });
    const result = validateResultPayload(payload, questionnaire);

    expect(result.answers).toEqual(payload.answers);
    expect(result.importantQuestions).toEqual(payload.importantQuestions);
    expect(result.scores).toEqual(
      questionnaire.calculateScores(payload.answers, payload.importantQuestions)
    );
    expect(result.percentages).toEqual(
      questionnaire.calculateAxisPercentages(
        result.scores,
        payload.importantQuestions
      )
    );
    expect(result.scores.government).not.toBe(9999);
  });

  it("keeps all axis percentages inside the expected range", () => {
    for (const answer of [0, 1, 2, 3, 4]) {
      const result = validateResultPayload(
        makePayload({ answers: new Array(60).fill(answer) }),
        questionnaire
      );
      Object.values(result.percentages).forEach((percentage) => {
        expect(percentage).toBeGreaterThanOrEqual(-100);
        expect(percentage).toBeLessThanOrEqual(100);
      });
    }
  });

  it("maps support for each key question to the intended axis direction", () => {
    function percentageFor(questionIndex, selectedOption) {
      const answers = new Array(questionnaire.questions.length).fill(2);
      answers[questionIndex] = selectedOption;
      return questionnaire.calculateAxisPercentages(
        questionnaire.calculateScores(answers)
      );
    }

    expect(percentageFor(20, 0).han).toBeGreaterThan(0);
    expect(percentageFor(23, 0).west).toBeGreaterThan(0);
    expect(percentageFor(25, 0).peace).toBeGreaterThan(0);
    expect(percentageFor(6, 0).social).toBeLessThan(0);
    expect(percentageFor(18, 0).political).toBeLessThan(0);
    expect(percentageFor(45, 0).gender).toBeGreaterThan(0);
    expect(percentageFor(48, 0).gender).toBeLessThan(0);
    expect(percentageFor(50, 0).gender).toBeGreaterThan(0);
  });

  it("generates fiscal hints in the correct direction", () => {
    const infrastructure = questionnaire.questions[1];
    const reduceTransfers = questionnaire.questions[59];
    const noHintQuestion = questionnaire.questions[0];

    expect(questionnaire.getOptionFiscalHint(infrastructure, 0)).toBe(
      "该选项会增加财政支出"
    );
    expect(questionnaire.getOptionFiscalHint(infrastructure, 2)).toBe("");
    expect(questionnaire.getOptionFiscalHint(infrastructure, 4)).toBe(
      "该选项会减少财政支出"
    );
    expect(questionnaire.getOptionFiscalHint(reduceTransfers, 0)).toBe(
      "该选项会减少财政支出"
    );
    expect(questionnaire.getOptionFiscalHint(reduceTransfers, 4)).toBe(
      "该选项会增加财政支出"
    );
    expect(questionnaire.getOptionFiscalHint(noHintQuestion, 0)).toBe("");
  });

  it("boosts marked questions without changing the percentage scale", () => {
    const answers = new Array(questionnaire.questions.length).fill(2);
    answers[0] = 0;
    answers[1] = 4;
    const importantQuestions = new Array(questionnaire.questions.length).fill(false);

    const baseScores = questionnaire.calculateScores(
      answers,
      importantQuestions
    );
    const basePercentages =
      questionnaire.calculateAxisPercentages(baseScores, importantQuestions);

    importantQuestions[0] = true;
    const boostedScores = questionnaire.calculateScores(
      answers,
      importantQuestions
    );
    const boostedPercentages =
      questionnaire.calculateAxisPercentages(boostedScores, importantQuestions);

    expect(boostedScores.government).toBeGreaterThan(baseScores.government);
    expect(boostedPercentages.government).toBe(
      Math.round(
        (boostedScores.government /
          (questionnaire.meta.importanceMultiplier * 2 * 2 + 23 * 2)) *
          100
      )
    );
    expect(boostedPercentages.government).toBeGreaterThan(
      basePercentages.government
    );
    Object.values(boostedPercentages).forEach((percentage) => {
      expect(percentage).toBeGreaterThanOrEqual(-100);
      expect(percentage).toBeLessThanOrEqual(100);
    });
  });

  it.each([
    ["wrong version", { testVersion: "old-version" }, "version_mismatch"],
    ["missing consent", { consent: false }, "consent_required"],
    ["wrong consent version", { consentVersion: "old-version" }, "consent_required"],
    ["short answers", { answers: new Array(59).fill(2) }, "invalid_answers"],
    ["invalid option", { answers: [5, ...new Array(59).fill(2)] }, "invalid_answers"],
    ["missing importance", { importantQuestions: undefined }, "invalid_important_questions"],
    ["short importance", { importantQuestions: new Array(59).fill(false) }, "invalid_important_questions"],
    ["invalid importance value", { importantQuestions: [1, ...new Array(59).fill(false)] }, "invalid_important_questions"],
    ["invalid timestamp", { startedAt: "not-a-date" }, "invalid_timestamp"],
    ["reversed timestamps", {
      startedAt: "2026-11-10T10:10:00.000Z",
      completedAt: "2026-11-10T10:00:00.000Z",
    }, "invalid_timestamp"],
    ["invalid duration", { durationMs: -1 }, "invalid_duration"],
  ])("rejects %s", (_name, overrides, code) => {
    try {
      validateResultPayload(makePayload(overrides), questionnaire);
      throw new Error("Expected validation to fail.");
    } catch (error) {
      expect(error.code).toBe(code);
    }
  });
});

describe("CSV export", () => {
  it("contains all result fields, axes and answers", () => {
    const record = {
      result_id: "result-1",
      client_id: "client-1",
      test_version: questionnaire.meta.testVersion,
      consent_version: questionnaire.meta.consentVersion,
      started_at: "2026-11-10T10:00:00.000Z",
      completed_at: "2026-11-10T10:08:00.000Z",
      duration_ms: 480000,
      answers_json: JSON.stringify(new Array(60).fill(2)),
      importance_json: JSON.stringify([
        true,
        ...new Array(58).fill(false),
        true,
      ]),
      scores_json: JSON.stringify({ government: 1 }),
      percentages_json: JSON.stringify({ government: 10 }),
      created_at: "2026-11-10T10:08:01.000Z",
    };

    const header = buildCsvHeader(questionnaire);
    const row = buildCsvRecord(record, questionnaire);
    const document = buildCsvDocument([record], questionnaire);

    expect(header).toContain("score_government,percentage_government");
    expect(header).toContain("q01");
    expect(header).toContain("score_gender,percentage_gender");
    expect(header).toContain("q60");
    expect(header).toContain("importance_count");
    expect(header).toContain("important_q01");
    expect(header).toContain("important_q60");
    expect(row).toContain("result-1,client-1");
    const fields = row.split(",");
    expect(fields[8]).toBe("2");
    expect(fields.at(-60)).toBe("1");
    expect(fields.at(-1)).toBe("1");
    expect(document.startsWith("\uFEFF")).toBe(true);
    expect(document.split("\r\n")).toHaveLength(3);
  });

  it("accepts normal UUIDs and rejects malformed ids", () => {
    expect(isUuid("123e4567-e89b-42d3-a456-426614174000")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
  });
});
