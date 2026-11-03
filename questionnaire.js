(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.QUESTIONNAIRE = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const meta = {
    testVersion: "2026-11-03",
    consentVersion: "2026-10-29",
  };

  const options = [
    ["很支持", 2],
    ["一般支持", 1],
    ["中立", 0],
    ["一般不支持", -1],
    ["很不支持", -2],
  ];

  const axes = [
    { key: "government", name: "政府规模", left: "小政府", right: "大政府" },
    { key: "income", name: "经济分配", left: "偏高收入", right: "偏低收入" },
    { key: "social", name: "社会价值", left: "社会保守", right: "社会自由" },
    { key: "political", name: "政治制度", left: "权力集中", right: "政治开放" },
    {
      key: "han",
      name: "民族文化",
      left: "多元文化",
      right: "大汉族主义",
      invert: true,
    },
    { key: "culture", name: "文化取向", left: "文化保守", right: "文化开放" },
    {
      key: "peace",
      name: "外交军事",
      left: "武力主义",
      right: "和平主义",
      invert: true,
    },
    {
      key: "west",
      name: "国际取向",
      left: "反欧美中心",
      right: "亲欧美",
      invert: true,
    },
  ];

  const questions = [
    {
      section: "财政问题",
      text: "你是否支持保护房价",
      effects: { government: 1, income: 0.8 },
    },
    {
      section: "财政问题",
      text: "你是否支持继续大基建拉动经济",
      effects: { government: 1, income: 1 },
    },
    {
      section: "财政问题",
      text: "你是否支持设立最低工资",
      effects: { government: 1, income: 1 },
    },
    {
      section: "财政问题",
      text: "你是否支持个人购置城市土地建房子",
      effects: { government: -0.5, income: 0.7 },
    },
    {
      section: "财政问题",
      text: "你是否支持每人每年一个固定数额的医保和退休金制度支出",
      effects: { government: 1, income: 1 },
    },
    {
      section: "社会制度",
      text: "你是否支持取消户口自由迁徙限制？",
      effects: { government: -1, income: 1 },
    },
    {
      section: "社会制度",
      text: "你是否支持婚前财产在离婚时进行分割？",
      effects: { social: 1, income: 1 },
    },
    {
      section: "社会制度",
      text: "你是否支持设立保护同性伴侣同等民事权利的制度",
      effects: { social: 1 },
    },
    {
      section: "社会制度",
      text: "你是否支持犯罪记录公开（服刑过后依然有标签）",
      effects: { social: -1 },
    },
    {
      section: "社会制度",
      text: "你是否支持身份证上划分各民族",
      effects: { han: 0.5 },
    },
    {
      section: "税收",
      text: "你是否支持购买商品时标注消费税数额",
      effects: { government: 0.2 },
    },
    {
      section: "税收",
      text: "你是否支持设立房产税",
      effects: { government: 1, income: 1 },
    },
    {
      section: "税收",
      text: "你是否支持下调个人所得税起征点",
      effects: { government: 1, income: 1 },
    },
    {
      section: "税收",
      text: "你是否支持设立遗产税",
      effects: { government: 1, income: 1 },
    },
    {
      section: "税收",
      text: "你是否支持增加企业所得税",
      effects: { government: 1, income: 1 },
    },
    {
      section: "政治制度",
      text: "你是否支持多党制",
      effects: { political: 1 },
    },
    {
      section: "政治制度",
      text: "你是否支持自由结社权利以及宗教信仰自由",
      effects: { political: 1 },
    },
    {
      section: "政治制度",
      text: "你是否支持报社新闻媒体自由",
      effects: { political: 1 },
    },
    {
      section: "政治制度",
      text: "你是否支持互联网城墙",
      effects: { political: -1 },
    },
    {
      section: "政治制度",
      text: "你是否支持民选产生官员",
      effects: { political: 1 },
    },
    {
      section: "民族文化",
      text: "你是否支持中华文化是以汉族文化为主导的",
      effects: { han: -2, culture: -1 },
    },
    {
      section: "民族文化",
      text: "你是否支持对少数民族地区推行汉化政策",
      effects: { han: -1, culture: -1 },
    },
    {
      section: "民族文化",
      text: "你是否支持保护少数民族文化语言的专项政策（包括地方方言）",
      effects: { han: 0.5, culture: 1 },
    },
    {
      section: "民族文化",
      text: "你是否支持过洋节",
      effects: { culture: 1, west: -1 },
    },
    {
      section: "民族文化",
      text: "你是否支持设立一门外语作为义务教育主课",
      effects: { culture: 1, west: -1 },
    },
    {
      section: "地缘外交",
      text: "关于台湾问题，你是否支持维持现状、坚持一个中国各自表述，而不以武力解决？",
      effects: { peace: -1, west: -0.5 },
    },
    {
      section: "地缘外交",
      text: "你是否支持俄罗斯入侵乌克兰",
      effects: { peace: 1, west: 2 },
    },
    {
      section: "地缘外交",
      text: "你是否支持美国进攻伊朗",
      effects: { peace: 1, west: -2 },
    },
    {
      section: "地缘外交",
      text: "你是否支持哈马斯进攻以色列",
      effects: { peace: 1, west: 2 },
    },
    {
      section: "地缘外交",
      text: "你是否支持如果有可能，尝试恢复部分外东北、外西北，甚至蒙古地区",
      effects: { peace: 1, han: -0.5, west: -0.5 },
    },
    {
      section: "扩展题组",
      text: "你是否支持增加政府对金融业的监管？",
      effects: { government: 1 },
    },
    {
      section: "扩展题组",
      text: "你是否支持退休金政策对职工与城镇居民实行统一标准？",
      effects: { government: 1, income: 1 },
    },
    {
      section: "扩展题组",
      text: "你是否支持医疗保险对职工与城镇居民建立统一标准？",
      effects: { government: 1, income: 1 },
    },
    {
      section: "扩展题组",
      text: "你是否支持建立独立于企业管理层和政府的工会？",
      effects: { political: 1, income: 0.5 },
    },
    {
      section: "扩展题组",
      text: "你是否支持取消高中阶段以延长在校时间、压缩休息日为核心的高强度管理模式，并至少保证完整双休日？",
      effects: { social: 1 },
    },
    {
      section: "扩展题组",
      text: "你是否支持法院在家暴案件中主动签发人身安全保护令并依职权调查取证？",
      effects: { social: 1 },
    },
    {
      section: "扩展题组",
      text: "你是否支持废除寻衅滋事罪？",
      effects: { political: 1, social: 0.5 },
    },
    {
      section: "扩展题组",
      text: "你是否支持对公开出版物（包括视频和音乐）进行政治立场审查？",
      effects: { political: -1, social: -0.5 },
    },
    {
      section: "扩展题组",
      text: "你是否支持取消政法委，使公安机关、检察院和法院分开办案？",
      effects: { political: 1 },
    },
    {
      section: "扩展题组",
      text: "你是否支持政府监测并控制网络舆情？",
      effects: { political: -1, social: -0.5 },
    },
    {
      section: "扩展题组",
      text: "你是否支持中央政府为地方债务兜底？",
      effects: { government: 1 },
    },
    {
      section: "扩展题组",
      text: "你是否支持国家提供无偿对外援助？",
      effects: { government: 0.25 },
    },
    {
      section: "扩展题组",
      text: "你是否支持国家承担可能亏损的对外援建项目？",
      effects: { government: 0.25 },
    },
    {
      section: "扩展题组",
      text: "你是否支持设置离婚冷静期？",
      effects: { social: -1 },
    },
    {
      section: "扩展题组",
      text: "你是否支持地方官员主要由本地产生，而不是由中央任命？",
      effects: { political: 0.5 },
    },
    {
      section: "扩展题组",
      text: "你是否支持地方官员在问责上优先对本地居民负责，而不是主要对中央负责？",
      effects: { political: 0.5 },
    },
    {
      section: "扩展题组",
      text: "你是否支持地方设立立法机关并制定适用于本地的法律？",
      effects: { political: 1 },
    },
  ];

  const axisKeys = new Set(axes.map((axis) => axis.key));

  if (!questions.length) {
    throw new Error("Questionnaire must contain at least one question.");
  }
  if (options.length !== 5) {
    throw new Error("Questionnaire must contain exactly five options.");
  }

  questions.forEach((question, index) => {
    if (!question.section || !question.text) {
      throw new Error(`Question ${index} is missing section or text.`);
    }
    const effectEntries = Object.entries(question.effects || {});
    if (!effectEntries.length) {
      throw new Error(`Question ${index} has no axis effects.`);
    }
    effectEntries.forEach(([axisKey, weight]) => {
      if (!axisKeys.has(axisKey)) {
        throw new Error(`Question ${index} references unknown axis ${axisKey}.`);
      }
      if (!Number.isFinite(weight) || weight === 0) {
        throw new Error(`Question ${index} has an invalid axis weight.`);
      }
    });
  });

  function calculateScores(answers) {
    const scores = {};
    axes.forEach((axis) => {
      scores[axis.key] = 0;
    });

    questions.forEach((question, questionIndex) => {
      const selected = answers[questionIndex];
      if (selected === null || selected === undefined) {
        return;
      }

      const option = options[selected];
      if (!option) {
        throw new RangeError(`Invalid answer at question ${questionIndex}.`);
      }

      const value = option[1];
      Object.entries(question.effects).forEach(([axisKey, weight]) => {
        scores[axisKey] += value * weight;
      });
    });

    return scores;
  }

  function calculateAxisPercentages(scores) {
    const percentages = {};

    axes.forEach((axis) => {
      let max = 0;
      questions.forEach((question) => {
        if (question.effects[axis.key]) {
          max += Math.abs(question.effects[axis.key]) * 2;
        }
      });

      const rawRatio = max
        ? Math.max(-1, Math.min(1, scores[axis.key] / max))
        : 0;
      const ratio = axis.invert ? -rawRatio : rawRatio;
      percentages[axis.key] = Math.round(ratio * 100);
    });

    return percentages;
  }

  return {
    meta,
    options,
    axes,
    questions,
    calculateScores,
    calculateAxisPercentages,
  };
});
