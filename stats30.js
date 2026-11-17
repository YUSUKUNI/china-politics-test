(() => {
  "use strict";

  const configuredApi = String(globalThis.POLITICS_TEST_CONFIG?.apiBase || "").replace(/\/+$/, "");
  const isGitHubPages = /\.github\.io$/i.test(location.hostname);
  const apiBase = /^(127\.0\.0\.1|localhost)$/i.test(location.hostname) ? "" : configuredApi;
  const apiReady = Boolean(apiBase) || !isGitHubPages;

  const els = {
    refresh: document.getElementById("refresh-button"),
    lastUpdated: document.getElementById("last-updated"),
    error: document.getElementById("error-banner"),
    metrics: document.getElementById("metric-grid"),
    answerCount: document.getElementById("answer-count"),
    overviewBar: document.getElementById("overview-bar"),
    overviewLegend: document.getElementById("overview-legend"),
    search: document.getElementById("search-input"),
    sort: document.getElementById("sort-select"),
    listSummary: document.getElementById("list-summary"),
    questionList: document.getElementById("question-list"),
    empty: document.getElementById("empty-state"),
  };

  const state = {
    data: null,
    search: "",
    sort: "number",
    loading: false,
  };

  const segmentClasses = [
    "seg-support-strong",
    "seg-support",
    "seg-neutral",
    "seg-oppose",
    "seg-oppose-strong",
    "seg-uncertain",
  ];

  els.refresh.addEventListener("click", () => loadStats(true));
  els.search.addEventListener("input", () => {
    state.search = els.search.value.trim().toLowerCase();
    renderQuestions();
  });
  els.sort.addEventListener("change", () => {
    state.sort = els.sort.value;
    renderQuestions();
  });

  if (!apiReady) {
    showError("统计接口尚未配置，请检查 api-config.js。");
    return;
  }

  loadStats();
  setInterval(() => {
    if (document.visibilityState === "visible") {
      loadStats(false);
    }
  }, 60000);

  async function loadStats(showButtonState) {
    if (state.loading) {
      return;
    }
    state.loading = true;
    if (showButtonState) {
      els.refresh.disabled = true;
      els.refresh.textContent = "刷新中…";
    }
    try {
      const response = await fetch(`${apiBase}/api/survey30/stats`, {
        credentials: "omit",
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || `读取统计失败（HTTP ${response.status}）`);
      }
      if (!Array.isArray(data.questions) || !Array.isArray(data.options)) {
        throw new Error("统计接口返回格式不正确。");
      }
      state.data = data;
      hideError();
      renderAll();
    } catch (error) {
      console.error(error);
      showError(`${error.message || "网络连接失败"}。稍后会自动重试。`);
    } finally {
      state.loading = false;
      els.refresh.disabled = false;
      els.refresh.textContent = "刷新数据";
    }
  }

  function renderAll() {
    const data = state.data;
    els.lastUpdated.textContent = `更新于 ${formatDateTime(data.generatedAt)}`;
    renderMetrics(data);
    renderOverview(data);
    renderQuestions();
  }

  function renderMetrics(data) {
    const summary = data.summary || {};
    const cards = [
      {
        label: "样本数",
        value: formatInteger(summary.total),
        note: `去重设备 ${formatInteger(summary.uniqueClients)}`,
      },
      {
        label: "今日新增",
        value: formatInteger(summary.todayCount),
        note: "按北京时间",
      },
      {
        label: "平均用时",
        value: formatDuration(summary.averageDurationMs),
        note: "从开始到提交",
      },
      {
        label: "最近提交",
        value: summary.lastSubmittedAt ? formatShortTime(summary.lastSubmittedAt) : "尚无",
        note: summary.lastSubmittedAt ? formatDate(summary.lastSubmittedAt) : "等待第一份答卷",
      },
    ];

    els.metrics.textContent = "";
    cards.forEach((card) => {
      const article = document.createElement("article");
      article.className = "metric-card";
      const label = document.createElement("span");
      label.textContent = card.label;
      const value = document.createElement("strong");
      value.textContent = card.value;
      const note = document.createElement("small");
      note.textContent = card.note;
      article.append(label, value, note);
      els.metrics.appendChild(article);
    });
  }

  function renderOverview(data) {
    const overview = data.overview || {};
    const counts = Array.isArray(overview.optionCounts) ? overview.optionCounts : [];
    const percentages = Array.isArray(overview.optionPercentages) ? overview.optionPercentages : [];

    els.answerCount.textContent = `${formatInteger(overview.answerCount)} 个回答`;
    els.overviewBar.textContent = "";
    els.overviewLegend.textContent = "";

    data.options.forEach((option, index) => {
      const percentage = Number(percentages[index] || 0);
      if (percentage > 0) {
        const segment = document.createElement("div");
        segment.className = `bar-segment ${segmentClasses[index] || "seg-neutral"}`;
        segment.style.width = `${percentage}%`;
        segment.title = `${option.label}：${formatInteger(counts[index])}（${formatPct(percentage)}）`;
        els.overviewBar.appendChild(segment);
      }

      const item = document.createElement("div");
      item.className = "legend-item";
      const swatch = document.createElement("span");
      swatch.className = `legend-swatch ${segmentClasses[index] || "seg-neutral"}`;
      const label = document.createElement("span");
      label.textContent = option.label;
      const value = document.createElement("strong");
      value.textContent = `${formatPct(percentage)} · ${formatInteger(counts[index])}`;
      item.append(swatch, label, value);
      els.overviewLegend.appendChild(item);
    });
  }

  function renderQuestions() {
    const data = state.data;
    if (!data) {
      return;
    }
    const total = Number(data.summary?.total || 0);
    if (!total) {
      els.questionList.textContent = "";
      els.questionList.hidden = true;
      els.empty.hidden = false;
      els.listSummary.textContent = "尚无答卷。";
      return;
    }

    els.empty.hidden = true;
    els.questionList.hidden = false;

    let questions = data.questions.slice();
    if (state.search) {
      questions = questions.filter((question) =>
        `${question.number} ${question.text}`.toLowerCase().includes(state.search)
      );
    }

    questions.sort((left, right) => {
      if (state.sort === "support") {
        return (right.supportPercentage ?? -1) - (left.supportPercentage ?? -1);
      }
      if (state.sort === "oppose") {
        return (right.opposePercentage ?? -1) - (left.opposePercentage ?? -1);
      }
      if (state.sort === "uncertain") {
        return (right.uncertainPercentage ?? -1) - (left.uncertainPercentage ?? -1);
      }
      if (state.sort === "division") {
        const leftDivision = 100 - Math.abs((left.supportPercentage || 0) - (left.opposePercentage || 0));
        const rightDivision = 100 - Math.abs((right.supportPercentage || 0) - (right.opposePercentage || 0));
        return rightDivision - leftDivision;
      }
      return left.number - right.number;
    });

    els.listSummary.textContent = `显示 ${questions.length} / ${data.questions.length} 题 · 样本 ${formatInteger(total)} 份`;
    els.questionList.textContent = "";
    questions.forEach((question) => {
      els.questionList.appendChild(createQuestionCard(question, data.options));
    });
  }

  function createQuestionCard(question, options) {
    const card = document.createElement("article");
    card.className = "question-item";

    const top = document.createElement("div");
    top.className = "question-top";
    const number = document.createElement("span");
    number.className = "question-number";
    number.textContent = String(question.number).padStart(2, "0");
    const text = document.createElement("p");
    text.className = "question-text";
    text.textContent = question.text;
    const sample = document.createElement("span");
    sample.className = "sample-chip";
    sample.textContent = `${formatInteger(question.sampleCount)} 份`;
    top.append(number, text, sample);

    const bar = createStackedBar(question.optionPercentages, options, question.optionCounts);
    const pills = document.createElement("div");
    pills.className = "summary-pills";
    pills.append(
      createPill("support", "支持", formatPct(question.supportPercentage)),
      createPill("", "中立", formatPct(question.neutralPercentage)),
      createPill("oppose", "反对", formatPct(question.opposePercentage)),
      createPill("uncertain", "不确定", formatPct(question.uncertainPercentage)),
      createPill("index", "净支持指数", formatIndex(question.netSupportIndex))
    );

    const breakdown = document.createElement("div");
    breakdown.className = "option-breakdown";
    options.forEach((option, index) => {
      const item = document.createElement("div");
      item.className = "breakdown-item";
      const swatch = document.createElement("span");
      swatch.className = `legend-swatch ${segmentClasses[index] || "seg-neutral"}`;
      const label = document.createElement("span");
      label.textContent = option.label;
      const value = document.createElement("strong");
      value.textContent = formatPct(question.optionPercentages?.[index]);
      item.append(swatch, label, value);
      breakdown.appendChild(item);
    });

    card.append(top, bar, pills, breakdown);
    return card;
  }

  function createStackedBar(percentages, options, counts) {
    const bar = document.createElement("div");
    bar.className = "stacked-bar question-bar";
    options.forEach((option, index) => {
      const percentage = Number(percentages?.[index] || 0);
      if (percentage <= 0) {
        return;
      }
      const segment = document.createElement("div");
      segment.className = `bar-segment ${segmentClasses[index] || "seg-neutral"}`;
      segment.style.width = `${percentage}%`;
      segment.title = `${option.label}：${formatInteger(counts?.[index])}（${formatPct(percentage)}）`;
      bar.appendChild(segment);
    });
    return bar;
  }

  function createPill(className, label, value) {
    const pill = document.createElement("span");
    pill.className = `summary-pill ${className}`.trim();
    const text = document.createElement("span");
    text.textContent = `${label} `;
    const strong = document.createElement("strong");
    strong.textContent = value;
    pill.append(text, strong);
    return pill;
  }

  function showError(message) {
    els.error.textContent = message;
    els.error.hidden = false;
  }

  function hideError() {
    els.error.hidden = true;
    els.error.textContent = "";
  }

  function formatInteger(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString("zh-CN") : "0";
  }

  function formatPct(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${number.toFixed(1).replace(/\.0$/, "")}%` : "—";
  }

  function formatIndex(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return "—";
    }
    const rounded = Math.round(number * 10) / 10;
    return `${rounded > 0 ? "+" : ""}${rounded}`;
  }

  function formatDuration(value) {
    const ms = Number(value);
    if (!Number.isFinite(ms) || ms < 0) {
      return "—";
    }
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) {
      return `${seconds} 秒`;
    }
    const minutes = Math.round(seconds / 60);
    return `${minutes} 分钟`;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "—";
    }
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }

  function formatShortTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "—";
    }
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "刚刚";
    }
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }
})();
