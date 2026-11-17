(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.SURVEY30_STATS = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createEmptyQuestionCounts(survey) {
    return survey.questions.map(() => new Array(survey.options.length).fill(0));
  }

  function addAnswers(questionCounts, answers, survey) {
    if (!Array.isArray(answers)) {
      return;
    }
    survey.questions.forEach((_question, questionIndex) => {
      const answerIndex = answers[questionIndex];
      if (
        Number.isInteger(answerIndex) &&
        answerIndex >= 0 &&
        answerIndex < survey.options.length
      ) {
        questionCounts[questionIndex][answerIndex] += 1;
      }
    });
  }

  function addCount(questionCounts, questionIndex, answerIndex, count, survey) {
    if (
      Number.isInteger(questionIndex) &&
      questionCounts[questionIndex] &&
      Number.isInteger(answerIndex) &&
      answerIndex >= 0 &&
      answerIndex < survey.options.length
    ) {
      questionCounts[questionIndex][answerIndex] += Math.max(0, Number(count) || 0);
    }
  }

  function percentage(count, total) {
    return total ? Math.round((count / total) * 1000) / 10 : null;
  }

  function summarizeQuestionCounts(questionCounts, survey) {
    const questions = survey.questions.map((question, index) => {
      const optionCounts = questionCounts[index].slice();
      const sampleCount = optionCounts.reduce((sum, count) => sum + count, 0);
      const supportCount = optionCounts[0] + optionCounts[1];
      const neutralCount = optionCounts[2];
      const opposeCount = optionCounts[3] + optionCounts[4];
      const uncertainCount = optionCounts[5];
      const decidedCount = sampleCount - uncertainCount;
      const weightedPosition = optionCounts.reduce((sum, count, optionIndex) => {
        const value = survey.options[optionIndex].value;
        return sum + count * (value === null ? 0 : value);
      }, 0);

      return {
        number: question.number,
        id: question.id,
        text: question.text,
        sampleCount,
        decidedCount,
        optionCounts,
        optionPercentages: optionCounts.map((count) => percentage(count, sampleCount)),
        supportCount,
        neutralCount,
        opposeCount,
        uncertainCount,
        supportPercentage: percentage(supportCount, sampleCount),
        neutralPercentage: percentage(neutralCount, sampleCount),
        opposePercentage: percentage(opposeCount, sampleCount),
        uncertainPercentage: percentage(uncertainCount, sampleCount),
        supportOfDecidedPercentage: percentage(supportCount, decidedCount),
        opposeOfDecidedPercentage: percentage(opposeCount, decidedCount),
        netSupportIndex: decidedCount
          ? Math.round((weightedPosition / (decidedCount * 2)) * 1000) / 10
          : null,
      };
    });

    const overallOptionCounts = new Array(survey.options.length).fill(0);
    questionCounts.forEach((counts) => {
      counts.forEach((count, optionIndex) => {
        overallOptionCounts[optionIndex] += count;
      });
    });
    const overallTotal = overallOptionCounts.reduce((sum, count) => sum + count, 0);

    return {
      questions,
      overall: {
        optionCounts: overallOptionCounts,
        optionPercentages: overallOptionCounts.map((count) =>
          percentage(count, overallTotal)
        ),
        answerCount: overallTotal,
      },
    };
  }

  return {
    createEmptyQuestionCounts,
    addAnswers,
    addCount,
    summarizeQuestionCounts,
  };
});
