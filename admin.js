(function () {
  "use strict";

  const API_BASE = String(globalThis.POLITICS_TEST_CONFIG?.apiBase || "").replace(/\/+$/, "");
  const SESSION_KEY = "china_politics_test_admin_token";
  const QUESTIONNAIRE = globalThis.QUESTIONNAIRE;
  const AXIS_SHORT = {
    government: "政",
    income: "经",
    social: "社",
    political: "制",
    han: "民",
    peace: "外",
    west: "际",
    gender: "性",
  };
  const numberFormatter = new Intl.NumberFormat("zh-CN");
  const chinaDateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const chinaDateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const chinaShortDateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const chinaClockFormatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const el = {
    loginView: document.getElementById("login-view"),
    dashboardView: document.getElementById("dashboard-view"),
    loginForm: document.getElementById("login-form"),
    tokenInput: document.getElementById("token-input"),
    toggleToken: document.getElementById("toggle-token"),
    loginButton: document.getElementById("login-button"),
    loginStatus: document.getElementById("login-status"),
    syncStatus: document.getElementById("sync-status"),
    refreshButton: document.getElementById("refresh-button"),
    exportButton: document.getElementById("export-button"),
    logoutButton: document.getElementById("logout-button"),
    lastUpdated: document.getElementById("last-updated"),
    appStatus: document.getElementById("app-status"),
    statsGrid: document.getElementById("stats-grid"),
    axisSummary: document.getElementById("axis-summary"),
    trendChart: document.getElementById("trend-chart"),
    importantRanking: document.getElementById("important-ranking"),
    versionSummary: document.getElementById("version-summary"),
    tableSummary: document.getElementById("table-summary"),
    pageSize: document.getElementById("page-size"),
    filterForm: document.getElementById("filter-form"),
    versionFilter: document.getElementById("version-filter"),
    fromFilter: document.getElementById("from-filter"),
    toFilter: document.getElementById("to-filter"),
    searchFilter: document.getElementById("search-filter"),
    clearFilters: document.getElementById("clear-filters"),
    resultsBody: document.getElementById("results-body"),
    prevPage: document.getElementById("prev-page"),
    nextPage: document.getElementById("next-page"),
    pageInfo: document.getElementById("page-info"),
    detailOverlay: document.getElementById("detail-overlay"),
    detailTitle: document.getElementById("detail-title"),
    detailSubtitle: document.getElementById("detail-subtitle"),
    detailClose: document.getElementById("detail-close"),
    detailMeta: document.getElementById("detail-meta"),
    detailAxes: document.getElementById("detail-axes"),
    detailAnswers: document.getElementById("detail-answers"),
  };

  const state = {
    token: "",
    data: null,
    page: 1,
    pageSize: 20,
    version: "",
    from: "",
    to: "",
    q: "",
    loading: false,
    lastFocusedElement: null,
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => {
      const replacements = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      };
      return replacements[character];
    });
  }

  function isNumericValue(value) {
    return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  }

  function formatNumber(value) {
    if (!isNumericValue(value)) {
      return "—";
    }
    const number = Number(value);
    return Number.isFinite(number) ? numberFormatter.format(number) : "—";
  }

  function formatPercent(value) {
    if (!isNumericValue(value)) {
      return "—";
    }
    const number = Number(value);
    const rounded = Math.round(number * 10) / 10;
    const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return `${rounded > 0 ? "+" : ""}${text}%`;
  }

  function formatDuration(value) {
    if (!isNumericValue(value)) {
      return "—";
    }
    const milliseconds = Number(value);
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      return "—";
    }
    const totalSeconds = Math.round(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      return `${hours} 小时 ${minutes % 60} 分`;
    }
    return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
  }

  function formatDateTime(value) {
    if (!value) {
      return "—";
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : chinaDateTimeFormatter.format(date).replace(/\//g, "-");
  }

  function formatShortDateTime(value) {
    if (!value) {
      return "—";
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : chinaShortDateTimeFormatter.format(date).replace(/\//g, "-");
  }

  function formatClock(value) {
    const date = value ? new Date(value) : new Date();
    return Number.isNaN(date.getTime()) ? "—" : chinaClockFormatter.format(date);
  }

  function getChinaDateKey(date) {
    const parts = chinaDateFormatter.formatToParts(date);
    const values = {};
    parts.forEach((part) => {
      if (part.type !== "literal") {
        values[part.type] = part.value;
      }
    });
    return `${values.year}-${values.month}-${values.day}`;
  }

  function getRecentChinaDays(dayCount) {
    const now = Date.now();
    const days = [];
    for (let offset = dayCount - 1; offset >= 0; offset -= 1) {
      days.push(getChinaDateKey(new Date(now - offset * 24 * 60 * 60 * 1000)));
    }
    return days;
  }

  function percentageTone(value) {
    if (!isNumericValue(value)) {
      return "mid";
    }
    const number = Number(value);
    return number > 0 ? "pos" : number < 0 ? "neg" : "mid";
  }

  function shortId(value) {
    const text = String(value || "");
    return text.length > 10 ? `${text.slice(0, 8)}…` : text || "—";
  }

  function setLoginStatus(message, type = "") {
    el.loginStatus.textContent = message || "";
    el.loginStatus.className = `inline-status${type ? ` ${type}` : ""}`;
  }

  function setAppStatus(message, type = "") {
    el.appStatus.textContent = message || "";
    el.appStatus.className = `app-status${type ? ` ${type}` : ""}`;
  }

  function setBusy(isBusy) {
    state.loading = isBusy;
    el.refreshButton.disabled = isBusy;
    el.exportButton.disabled = isBusy || !state.token;
    el.loginButton.disabled = isBusy || !API_BASE;
  }

  function readSessionToken() {
    try {
      return sessionStorage.getItem(SESSION_KEY) || "";
    } catch {
      return "";
    }
  }

  function writeSessionToken(token) {
    try {
      sessionStorage.setItem(SESSION_KEY, token);
    } catch {
      // The page remains usable for the current page lifetime without session storage.
    }
  }

  function clearSessionToken() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // Nothing else to clear.
    }
  }

  function showLoginView(message = "", type = "") {
    el.dashboardView.hidden = true;
    el.loginView.hidden = false;
    if (message) {
      setLoginStatus(message, type);
    }
  }

  function showDashboardView() {
    el.loginView.hidden = true;
    el.dashboardView.hidden = false;
    setLoginStatus("");
  }

  function handleUnauthorized(message) {
    clearSessionToken();
    state.token = "";
    state.data = null;
    closeDetail({ restoreFocus: false });
    showLoginView(message, "error");
    setBusy(false);
  }

  function buildDashboardPath() {
    const params = new URLSearchParams({
      page: String(state.page),
      pageSize: String(state.pageSize),
    });
    if (state.version) {
      params.set("version", state.version);
    }
    if (state.from) {
      params.set("from", state.from);
    }
    if (state.to) {
      params.set("to", state.to);
    }
    if (state.q) {
      params.set("q", state.q);
    }
    return `/api/admin/results?${params.toString()}`;
  }

  async function fetchDashboard() {
    const response = await fetch(`${API_BASE}${buildDashboardPath()}`, {
      headers: { Authorization: `Bearer ${state.token}` },
      credentials: "omit",
      cache: "no-store",
    });

    if (response.status === 401) {
      handleUnauthorized("管理令牌无效或已过期，请重新输入。");
      return false;
    }

    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const payload = await response.json();
        message = payload.message || message;
      } catch {
        // Keep the HTTP status when the response is not JSON.
      }
      throw new Error(message);
    }

    const data = await response.json();
    state.data = data;
    state.page = data.pagination.page;
    state.pageSize = data.pagination.pageSize;
    renderDashboard();
    showDashboardView();
    return true;
  }

  async function loadDashboard(options = {}) {
    if (state.loading) {
      return false;
    }
    setBusy(true);
    setAppStatus("");
    el.syncStatus.textContent = "正在同步…";
    try {
      const ok = await fetchDashboard();
      if (ok && options.fromLogin) {
        writeSessionToken(state.token);
      }
      return ok;
    } catch (error) {
      const message = `数据读取失败：${error.message}`;
      if (!el.loginView.hidden) {
        setLoginStatus(message, "error");
      } else {
        setAppStatus(message, "error");
      }
      el.syncStatus.textContent = "同步失败";
      return false;
    } finally {
      setBusy(false);
    }
  }

  function renderDashboard() {
    if (!state.data) {
      return;
    }
    closeDetail({ restoreFocus: false });
    renderStats();
    renderFilters();
    renderAxes();
    renderTrend();
    renderImportantRanking();
    renderVersions();
    renderResults();

    const lastSubmittedAt = state.data.summary.lastSubmittedAt;
    el.lastUpdated.textContent = lastSubmittedAt
      ? `最近提交：${formatDateTime(lastSubmittedAt)}（北京时间）`
      : "数据库中还没有答卷。";
    el.syncStatus.textContent = `更新于 ${formatClock(state.data.generatedAt)}`;
  }

  function renderStats() {
    const summary = state.data.summary;
    const cards = [
      ["提交总数", formatNumber(summary.total), "当前筛选范围"],
      ["独立设备", formatNumber(summary.uniqueClients), "按匿名设备 ID 去重"],
      ["今日新增", formatNumber(summary.todayCount), "全站 · 北京时间"],
      ["平均耗时", formatDuration(summary.averageDurationMs), "当前筛选范围"],
      ["重点题标记", formatNumber(summary.importanceMarks), "当前筛选范围"],
    ];
    el.statsGrid.innerHTML = cards
      .map(
        ([label, value, hint]) => `
          <article class="stat-card">
            <p class="stat-label">${label}</p>
            <p class="stat-value">${value}</p>
            <p class="stat-hint">${hint}</p>
          </article>
        `
      )
      .join("");
  }

  function renderFilters() {
    const versions = state.data.summary.versions || [];
    el.versionFilter.innerHTML = [
      '<option value="">全部版本</option>',
      ...versions.map(
        (version) =>
          `<option value="${escapeHtml(version.version)}">${escapeHtml(version.version)} (${formatNumber(version.count)})</option>`
      ),
    ].join("");
    if (state.version && !versions.some((version) => version.version === state.version)) {
      el.versionFilter.insertAdjacentHTML(
        "beforeend",
        `<option value="${escapeHtml(state.version)}">${escapeHtml(state.version)}</option>`
      );
    }
    el.versionFilter.value = state.version;
    el.fromFilter.value = state.from;
    el.toFilter.value = state.to;
    el.searchFilter.value = state.q;
    el.pageSize.value = String(state.pageSize);
  }

  function buildAxisRows(axes, valueAccessor, rangeAccessor = null) {
    return axes
      .map((axis) => {
        const value = valueAccessor(axis);
        const tone = percentageTone(value);
        const valid = isNumericValue(value);
        const width = valid ? Math.min(50, Math.abs(Number(value)) / 2) : 0;
        const range = rangeAccessor ? rangeAccessor(axis) : "";
        return `
          <div class="axis-row" title="${escapeHtml(range)}">
            <div class="axis-label">
              <span class="axis-name">${escapeHtml(axis.name)}</span>
              <span class="axis-direction">${escapeHtml(axis.left)} ↔ ${escapeHtml(axis.right)}</span>
            </div>
            <div class="axis-track" aria-hidden="true">
              <span class="axis-fill ${tone}" style="width:${width}%"></span>
            </div>
            <span class="axis-value ${tone}">${formatPercent(value)}</span>
          </div>
        `;
      })
      .join("");
  }

  function renderAxes() {
    const axes = state.data.summary.axes || [];
    if (!axes.length) {
      el.axisSummary.innerHTML = '<p class="empty-state">暂无数据。</p>';
      return;
    }
    el.axisSummary.innerHTML = buildAxisRows(
      axes,
      (axis) => axis.averagePercentage,
      (axis) => {
        if (axis.minPercentage === null || axis.maxPercentage === null) {
          return "暂无样本";
        }
        return `样本范围：${formatPercent(axis.minPercentage)} 至 ${formatPercent(axis.maxPercentage)}`;
      }
    );
  }

  function renderTrend() {
    const days = getRecentChinaDays(14);
    const dailyCounts = new Map(
      (state.data.summary.daily || []).map((item) => [item.date, Number(item.count) || 0])
    );
    const values = days.map((day) => dailyCounts.get(day) || 0);
    const maximum = Math.max(1, ...values);
    el.trendChart.innerHTML = days
      .map((day, index) => {
        const count = values[index];
        const height = count ? Math.max(8, Math.round((count / maximum) * 132)) : 3;
        return `
          <div class="trend-column" title="${escapeHtml(day)}：${formatNumber(count)} 份">
            <span class="trend-count">${count || ""}</span>
            <span class="trend-bar${count ? "" : " empty"}" style="height:${height}px"></span>
            <span class="trend-date">${day.slice(5)}</span>
          </div>
        `;
      })
      .join("");
  }

  function renderImportantRanking() {
    const items = state.data.summary.topImportantQuestions || [];
    if (!items.length) {
      el.importantRanking.innerHTML = '<p class="empty-state">当前筛选范围还没有重点题标记。</p>';
      return;
    }
    const maximum = Math.max(1, ...items.map((item) => item.count));
    el.importantRanking.innerHTML = items
      .map(
        (item, index) => `
          <div class="rank-row">
            <span class="rank-index">${index + 1}</span>
            <div class="rank-main">
              <p class="rank-title" title="${escapeHtml(item.text)}">第 ${item.questionNumber} 题 · ${escapeHtml(item.text)}</p>
              <div class="rank-track"><div class="rank-fill" style="width:${Math.max(4, Math.round((item.count / maximum) * 100))}%"></div></div>
            </div>
            <div class="rank-meta">${formatNumber(item.count)} 次<br>${item.share}%</div>
          </div>
        `
      )
      .join("");
  }

  function renderVersions() {
    const versions = state.data.summary.versions || [];
    if (!versions.length) {
      el.versionSummary.innerHTML = '<p class="empty-state">暂无版本数据。</p>';
      return;
    }
    el.versionSummary.innerHTML = versions
      .map(
        (version) => `
          <div class="version-row">
            <span class="version-name" title="${escapeHtml(version.version)}">${escapeHtml(version.version)}</span>
            <span class="version-count">${formatNumber(version.count)}</span>
            <span class="version-date">${formatShortDateTime(version.lastSubmittedAt)}</span>
          </div>
        `
      )
      .join("");
  }

  function renderResults() {
    const results = state.data.results || [];
    const pagination = state.data.pagination;
    el.tableSummary.textContent = `共 ${formatNumber(pagination.total)} 份答卷当前筛选范围`;
    el.pageInfo.textContent = `第 ${pagination.page} / ${pagination.pageCount} 页 · 共 ${formatNumber(pagination.total)} 条`;
    el.prevPage.disabled = pagination.page <= 1;
    el.nextPage.disabled = pagination.page >= pagination.pageCount;

    if (!results.length) {
      el.resultsBody.innerHTML = '<tr><td class="empty-cell" colspan="7"><p class="empty-state">当前筛选范围没有答卷。</p></td></tr>';
      return;
    }

    el.resultsBody.innerHTML = results
      .map((result) => {
        const chips = QUESTIONNAIRE.axes
          .map((axis) => {
            const value = result.percentages?.[axis.key];
            const tone = percentageTone(value);
            return `<span class="axis-chip ${tone}" title="${escapeHtml(axis.name)}：${formatPercent(value)}">${AXIS_SHORT[axis.key] || "·"} ${formatPercent(value).replace("%", "")}</span>`;
          })
          .join("");
        const importance = result.importanceCount
          ? `<span class="importance-badge">★ ${formatNumber(result.importanceCount)}</span>`
          : "—";
        return `
          <tr>
            <td class="result-time">${formatDateTime(result.createdAt)}</td>
            <td><span class="version-badge">${escapeHtml(result.testVersion)}</span></td>
            <td><span class="client-id" title="${escapeHtml(result.clientId)}">${escapeHtml(shortId(result.clientId))}</span></td>
            <td class="result-duration">${formatDuration(result.durationMs)}</td>
            <td>${importance}</td>
            <td><div class="axis-chip-row">${chips}</div></td>
            <td><button class="view-button" type="button" data-view-result="${escapeHtml(result.resultId)}">查看</button></td>
          </tr>
        `;
      })
      .join("");
  }

  function renderDetailAxes(percentages) {
    return buildAxisRows(
      QUESTIONNAIRE.axes,
      (axis) => percentages?.[axis.key]
    );
  }

  function openDetail(resultId) {
    const result = (state.data?.results || []).find((item) => item.resultId === resultId);
    if (!result) {
      return;
    }
    state.lastFocusedElement = document.activeElement;
    el.detailTitle.textContent = `答卷 ${shortId(result.resultId)}`;
    el.detailSubtitle.textContent = `${formatDateTime(result.createdAt)} · ${result.testVersion}`;
    el.detailMeta.innerHTML = [
      ["提交时间", formatDateTime(result.createdAt)],
      ["完成时间", formatDateTime(result.completedAt)],
      ["测试版本", result.testVersion],
      ["耗时", formatDuration(result.durationMs)],
      ["重点题", `${formatNumber(result.importanceCount)} 道`],
      ["同意书版本", result.consentVersion],
      ["匿名设备", result.clientId],
      ["结果 ID", result.resultId],
    ]
      .map(
        ([label, value]) => `
          <div class="meta-item">
            <span class="meta-label">${label}</span>
            <span class="meta-value" title="${escapeHtml(value)}">${escapeHtml(value)}</span>
          </div>
        `
      )
      .join("");
    el.detailAxes.innerHTML = renderDetailAxes(result.percentages);
    el.detailAnswers.innerHTML = renderAnswers(result);
    el.detailOverlay.hidden = false;
    document.body.classList.add("drawer-open");
    requestAnimationFrame(() => el.detailClose.focus());
  }

  function renderAnswers(result) {
    const answers = Array.isArray(result.answers) ? result.answers : [];
    const importantQuestions = Array.isArray(result.importantQuestions)
      ? result.importantQuestions
      : [];
    return QUESTIONNAIRE.questions
      .map((question, index) => {
        const answerIndex = answers[index];
        const option = QUESTIONNAIRE.options[answerIndex];
        const optionValue = option ? option[1] : 0;
        const choiceClass = optionValue > 0 ? "support" : optionValue < 0 ? "oppose" : "";
        const isImportant = importantQuestions[index] === true;
        return `
          <article class="answer-card${isImportant ? " important" : ""}">
            <div class="answer-head">
              <span class="answer-number">第 ${index + 1} 题</span>
              <span class="answer-section" title="${escapeHtml(question.section)}">${escapeHtml(question.section)}</span>
              ${isImportant ? '<span class="answer-important" title="已标记为非常重要">★</span>' : ""}
            </div>
            <p class="answer-text">${escapeHtml(question.text)}</p>
            <span class="answer-choice ${choiceClass}">${escapeHtml(option ? option[0] : "无效回答")}</span>
          </article>
        `;
      })
      .join("");
  }

  function closeDetail(options = {}) {
    if (el.detailOverlay.hidden) {
      return;
    }
    el.detailOverlay.hidden = true;
    document.body.classList.remove("drawer-open");
    if (options.restoreFocus !== false && state.lastFocusedElement?.focus) {
      state.lastFocusedElement.focus();
    }
  }

  async function exportCsv() {
    if (!state.token || !API_BASE) {
      return;
    }
    el.exportButton.disabled = true;
    setAppStatus("正在生成完整 CSV…");
    try {
      const response = await fetch(`${API_BASE}/api/admin/results.csv`, {
        headers: { Authorization: `Bearer ${state.token}` },
        credentials: "omit",
        cache: "no-store",
      });
      if (response.status === 401) {
        handleUnauthorized("管理令牌无效或已过期，请重新输入。");
        return;
      }
      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const payload = await response.json();
          message = payload.message || message;
        } catch {
          // Keep the HTTP status when no JSON body is available.
        }
        throw new Error(message);
      }
      const disposition = response.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
      const filename = filenameMatch
        ? filenameMatch[1]
        : `china-politics-results-${new Date().toISOString().slice(0, 10)}.csv`;
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setAppStatus("CSV 已开始下载。", "success");
    } catch (error) {
      setAppStatus(`CSV 导出失败：${error.message}`, "error");
    } finally {
      el.exportButton.disabled = !state.token;
    }
  }

  function applyFiltersFromControls() {
    const from = el.fromFilter.value;
    const to = el.toFilter.value;
    if (from && to && from > to) {
      setAppStatus("开始日期不能晚于结束日期。", "error");
      return false;
    }
    state.version = el.versionFilter.value;
    state.from = from;
    state.to = to;
    state.q = el.searchFilter.value.trim();
    state.page = 1;
    return true;
  }

  function bindEvents() {
    el.loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const token = el.tokenInput.value.trim();
      if (!token) {
        setLoginStatus("请输入管理令牌。", "error");
        el.tokenInput.focus();
        return;
      }
      state.token = token;
      state.page = 1;
      const ok = await loadDashboard({ fromLogin: true });
      if (ok) {
        el.tokenInput.value = "";
      } else if (!state.token) {
        el.tokenInput.value = "";
      }
    });

    el.toggleToken.addEventListener("click", () => {
      const showing = el.tokenInput.type === "text";
      el.tokenInput.type = showing ? "password" : "text";
      el.toggleToken.textContent = showing ? "显示" : "隐藏";
      el.toggleToken.setAttribute("aria-label", showing ? "显示令牌" : "隐藏令牌");
    });

    el.refreshButton.addEventListener("click", () => loadDashboard());
    el.exportButton.addEventListener("click", exportCsv);
    el.logoutButton.addEventListener("click", () => {
      clearSessionToken();
      state.token = "";
      state.data = null;
      closeDetail({ restoreFocus: false });
      el.tokenInput.value = "";
      showLoginView("已退出管理后台。", "success");
      setBusy(false);
    });

    el.filterForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (applyFiltersFromControls()) {
        loadDashboard();
      }
    });

    el.clearFilters.addEventListener("click", () => {
      state.version = "";
      state.from = "";
      state.to = "";
      state.q = "";
      state.page = 1;
      el.versionFilter.value = "";
      el.fromFilter.value = "";
      el.toFilter.value = "";
      el.searchFilter.value = "";
      loadDashboard();
    });

    el.pageSize.addEventListener("change", () => {
      state.pageSize = Number(el.pageSize.value) || 20;
      state.page = 1;
      loadDashboard();
    });

    el.prevPage.addEventListener("click", () => {
      if (state.page > 1) {
        state.page -= 1;
        loadDashboard();
      }
    });

    el.nextPage.addEventListener("click", () => {
      if (state.data && state.page < state.data.pagination.pageCount) {
        state.page += 1;
        loadDashboard();
      }
    });

    el.resultsBody.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-view-result]");
      if (trigger) {
        openDetail(trigger.getAttribute("data-view-result"));
      }
    });

    el.detailClose.addEventListener("click", () => closeDetail());
    el.detailOverlay.addEventListener("click", (event) => {
      if (event.target === el.detailOverlay) {
        closeDetail();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeDetail();
      }
    });
  }

  async function bootstrap() {
    if (!QUESTIONNAIRE || !Array.isArray(QUESTIONNAIRE.axes) || !Array.isArray(QUESTIONNAIRE.questions)) {
      el.loginButton.disabled = true;
      setLoginStatus("题库脚本加载失败，请刷新页面或检查 questionnaire.js。", "error");
      return;
    }
    if (!API_BASE) {
      el.loginButton.disabled = true;
      setLoginStatus("尚未配置 Worker 地址。请先在 api-config.js 中填写 apiBase。", "error");
      return;
    }
    bindEvents();
    setBusy(false);
    const savedToken = readSessionToken();
    if (!savedToken) {
      showLoginView();
      return;
    }
    state.token = savedToken;
    const ok = await loadDashboard({ fromLogin: true });
    if (!ok && state.token) {
      showLoginView();
      setLoginStatus("无法连接后台，请检查网络后重新输入令牌。", "error");
    }
  }

  bootstrap();
})();
