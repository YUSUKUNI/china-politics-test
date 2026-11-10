(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.QUESTIONNAIRE = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const meta = {
    testVersion: "2026-11-10",
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
    { key: "social", name: "社会文化取向", left: "社会文化保守", right: "社会文化开放" },
    { key: "political", name: "政治制度", left: "权力集中", right: "政治开放" },
    { key: "han", name: "民族文化", left: "多元文化", right: "大汉族主义" },
    { key: "peace", name: "外交军事", left: "武力主义", right: "和平主义" },
    { key: "west", name: "国际取向", left: "反欧美中心", right: "亲欧美" },
    { key: "gender", name: "性别关系立场", left: "传统性别角色", right: "性别平等" },
  ];

  const questions = [
    {
      section: "财政问题",
      text: "你是否支持政府出台政策保护房价？",
      effects: { government: 2, income: 1.5 },
    },
    {
      section: "财政问题",
      text: "你是否支持继续大基建拉动经济？",
      effects: { government: 2, income: 1 },
    },
    {
      section: "财政问题",
      text: "你是否支持设立最低工资？",
      effects: { government: 1, income: 3 },
    },
    {
      section: "财政问题",
      text: "你是否支持个人有权购置城市土地建房子？",
      effects: { government: -1, income: 1 },
    },
    {
      section: "社会制度",
      text: "你是否支持取消户口自由迁徙限制？",
      effects: { income: 1, political: 2 },
    },
    {
      section: "社会制度",
      text: "你是否支持设立保护同性伴侣同等民事权利的制度？",
      effects: { social: 2 },
    },
    {
      section: "社会制度",
      text: "你是否支持犯罪记录公开（服刑过后依然有标签）？",
      effects: { social: -1 },
    },
    {
      section: "社会制度",
      text: "你是否支持身份证上划分各民族？",
      effects: { han: -1.5 },
    },
    {
      section: "税收",
      text: "你是否支持购买商品时标注消费税数额？",
      effects: { political: 1, income: 1.5 },
    },
    {
      section: "税收",
      text: "你是否支持设立房产税？",
      effects: { government: 1, income: 2 },
    },
    {
      section: "税收",
      text: "你是否支持扩大个人所得税的征税范围，让更多收入水平的人承担个人所得税？",
      effects: { government: 0.5, income: 1 },
    },
    {
      section: "税收",
      text: "你是否支持设立遗产税？",
      effects: { government: 0.5, income: 2 },
    },
    {
      section: "税收",
      text: "你是否支持增加企业所得税？",
      effects: { government: 1, income: 1.5 },
    },
    {
      section: "政治制度",
      text: "你是否支持多党制？",
      effects: { political: 3 },
    },
    {
      section: "政治制度",
      text: "你是否支持自由结社权利，例如组建独立的政治团体？",
      effects: { political: 3 },
    },
    {
      section: "政治制度",
      text: "你是否支持宗教信仰，并且拥有组织宗教团体结社的自由？",
      effects: { political: 1.5, social: 1 },
    },
    {
      section: "政治制度",
      text: "你是否支持公民不因自由表达观点而受到政府处罚，并能够自由发表和传播类似文章、音乐、视频等？",
      effects: { political: 2 },
    },
    {
      section: "政治制度",
      text: "你是否支持新闻媒体独立于政府开展采访、报道和评论，并监督政府公共事务？",
      effects: { political: 2 },
    },
    {
      section: "政治制度",
      text: "你是否支持互联网城墙？",
      effects: { political: -2, social: -1 },
    },
    {
      section: "政治制度",
      text: "你是否支持民选产生官员？",
      effects: { political: 3 },
    },
    {
      section: "民族文化",
      text: "你是否支持中华文化是以汉族文化为主导的？",
      effects: { han: 3 },
    },
    {
      section: "民族文化",
      text: "你是否支持对少数民族地区推行汉化政策？",
      effects: { han: 2 },
    },
    {
      section: "民族文化",
      text: "你是否支持保护少数民族文化语言的专项政策（包括地方方言）？",
      effects: { han: -1.5, government: 0.5 },
    },
    {
      section: "民族文化",
      text: "你是否支持过洋节？",
      effects: { social: 1, west: 1 },
    },
    {
      section: "民族文化",
      text: "你是否支持设立一门外语作为义务教育主课？",
      effects: { social: 1, west: 0.5 },
    },
    {
      section: "地缘外交",
      text: "关于台湾问题，你是否支持维持现状、坚持一个中国各自表述，而不以武力解决？",
      effects: { peace: 2, west: 2 },
    },
    {
      section: "地缘外交",
      text: "你是否支持俄罗斯入侵乌克兰？",
      effects: { peace: -2, west: -2 },
    },
    {
      section: "地缘外交",
      text: "你是否支持美国进攻伊朗？",
      effects: { peace: -2, west: 1 },
    },
    {
      section: "地缘外交",
      text: "你是否支持哈马斯进攻以色列？",
      effects: { peace: -2, west: -2 },
    },
    {
      section: "地缘外交",
      text: "你是否支持如果有可能，尝试以各种手段恢复部分外东北、外西北，甚至蒙古地区？",
      effects: { han: 1, peace: -1, west: -0.5 },
    },
    {
      section: "扩展题组",
      text: "你是否支持增加政府对金融业的监管？",
      effects: { government: 2 },
    },
    {
      section: "扩展题组",
      text: "你是否支持退休金政策对职工与城镇居民实行统一标准？",
      effects: { government: 0.5, income: 2 },
    },
    {
      section: "扩展题组",
      text: "你是否支持医疗保险对职工与城镇居民建立统一标准？",
      effects: { government: 0.5, income: 2 },
    },
    {
      section: "扩展题组",
      text: "你是否支持劳动者自由组建独立于政府和企业的工会，并开展集体谈判？",
      effects: { income: 2, political: 2 },
    },
    {
      section: "扩展题组",
      text: "你是否支持取消高中阶段的“衡水制”教育模式（以延长在校时间、压缩休息日为核心的高强度管理），并至少保证完整双休日？",
      effects: { social: 2, government: -1 },
    },
    {
      section: "扩展题组",
      text: "你是否支持法院在家暴案件中主动签发人身安全保护令，加强司法介入家庭内部事务？",
      effects: { social: 2, political: 1 },
    },
    {
      section: "扩展题组",
      text: "你是否支持废除寻衅滋事罪？",
      effects: { political: 2 },
    },
    {
      section: "扩展题组",
      text: "你是否支持取消政法委，使公安机关、检察院和法院分开办案？",
      effects: { political: 1.5 },
    },
    {
      section: "扩展题组",
      text: "你是否支持政府监测并控制网络舆情？",
      effects: { political: -2 },
    },
    {
      section: "扩展题组",
      text: "你是否支持中央政府为地方债务兜底？",
      effects: { government: 3, income: 1 },
    },
    {
      section: "扩展题组",
      text: "你是否支持国家提供无偿对外援助，或承担可能亏损的对外援建项目？",
      effects: { government: 1 },
    },
    {
      section: "扩展题组",
      text: "你是否支持设置离婚冷静期？",
      effects: { social: -1 },
    },
    {
      section: "扩展题组",
      text: "你是否支持地方官员主要由本地产生，而不是由中央任命（主要对地方问责而不是上级）？",
      effects: { political: 1 },
    },
    {
      section: "扩展题组",
      text: "你是否支持地方设立立法机关并制定适用于本地的法律？",
      effects: { political: 1 },
    },
    {
      section: "性别议题",
      text: "你是否支持在公共场所增加女性厕所的数量？",
      effects: { gender: 2, government: 1 },
    },
    {
      section: "性别议题",
      text: "你是否支持结婚时由男方承担主要的彩礼和婚礼费用？",
      effects: { gender: -3, social: -2 },
    },
    {
      section: "性别议题",
      text: "你是否支持企业为男性员工提供与女性员工相同的育儿假？",
      effects: { social: 2, government: 0.5 },
    },
    {
      section: "性别议题",
      text: "你是否支持男女实行相同的法定退休年龄？",
      effects: { gender: 1, government: 0.5, income: 0.5 },
    },
    {
      section: "性别议题",
      text: "你是否支持对男性遭受性骚扰建立与女性相同的法律保护机制，并增设针对男性受害者的强奸罪规定，而不只是以猥亵罪处理？",
      effects: { gender: 0.5, social: 1 },
    },
    {
      section: "性别议题",
      text: "你是否支持婚前个人财产在离婚时仍归原所有人，不因结婚而自动成为夫妻共同财产？",
      effects: { gender: -1 },
    },
    {
      section: "性别议题",
      text: "你是否支持夫妻离婚时，婚姻期间取得的共同财产原则上由双方平均分割？",
      effects: { gender: 1 },
    },
    {
      section: "公共政策",
      text: "你是否支持政府增加育儿补贴，以减轻家庭生育和养育子女的经济负担？",
      effects: { government: 1, income: 1.5 },
    },
    {
      section: "公共政策",
      text: "你是否支持低保人员通过资格审查后，可以自由支配领取的低保金，而不受到用途限制？",
      effects: { income: 0.5, social: 2 },
    },
    {
      section: "公共政策",
      text: "你是否支持取消内地居民前往香港、澳门的通行限制，让普通居民可以自由前往港澳旅游？",
      effects: { political: 1 },
    },
    {
      section: "公共政策",
      text: "你是否支持放开食品贸易保护政策，减少对外国廉价食品原材料进口的限制？",
      effects: { income: 1, government: -0.5 },
    },
    {
      section: "公共政策",
      text: "你是否支持允许民营企业进入更多受管制行业，参与铁路、电力等公共事业的投资和运营？",
      effects: { government: -2 },
    },
    {
      section: "公共政策",
      text: "你是否支持对严重侵犯人权的外国政府实施经济制裁，即使这会损害自身的经济利益？",
      effects: { west: 2, social: 1 },
    },
    {
      section: "公共政策",
      text: "你是否支持公示官员财产？",
      effects: { political: 2 },
    },
    {
      section: "公共政策",
      text: "你是否支持加强劳动法的执法力度，严格保障劳动法实施？",
      effects: { income: 2, government: 1 },
    },
    {
      section: "公共政策",
      text: "你是否支持减少对环境恶劣的少数民族地区的财政拨款？",
      effects: { han: 2, government: -1 },
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

      const ratio = max ? Math.max(-1, Math.min(1, scores[axis.key] / max)) : 0;
      const percentage = Math.round(ratio * 100);
      percentages[axis.key] = Object.is(percentage, -0) ? 0 : percentage;
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
