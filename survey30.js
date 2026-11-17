(() => {
  "use strict";

  const survey = globalThis.SURVEY30;
  if (!survey || !Array.isArray(survey.questions)) {
    document.body.innerHTML = "<p style=\padding:32px;font-family:sans-serif\>题库加载失败，请刷新页面。</p>";
    return;
  }

  const { meta, options, questions } = survey;
  const configuredApi = String(globalThis.POLITICS_TEST_CONFIG?.apiBase || "").replace(/\/+$/, "");
  const isGitHubPages = /\.github\.io$/i.test(location.hostname);
  const apiBase = /^(127\.0\.0\.1|localhost)$/i.test(location.hostname) ? "" : configuredApi;
  const apiReady = Boolean(apiBase) || !isGitHubPages;
  const clientId = getOrCreateClientId();

  const views = {
    intro: document.getElementById("intro-view"),
    question: document.getElementById("question-view"),
    complete: document.getElementById("complete-view"),
  };
  const consent = document.getElementById("consent-checkbox");
  const startButton = document.getElementById("start-button");
  const clientStatus = document.getElementById("client-status");
  const questionTitle = document.getElementById("question-title");
  const questionIndex = document.getElementById("question-index");
  const optionList = document.getElementById("option-list");
  const questionStatus = document.getElementById("question-status");
  const backButton = document.getElementById("back-button");
  const nextButton = document.getElementById("next-button");
  const progressLabel = document.getElementById("progress-label");
  const progressPercent = document.getElementById("progress-percent");
  const progressBar = document.getElementById("progress-bar");
  const completeMessage = document.getElementById("complete-message");

  let currentIndex = 0;
  let answers = new Array(questions.length).fill(null);
  let startedAt = null;
  let clientHasSubmitted = false;
  let submissionInFlight = false;

  startButton.disabled = true;
  consent.addEventListener("change", updateStartState);
  startButton.addEventListener("click", startSurvey);
  backButton.addEventListener("click", goBack);
  nextButton.addEventListener("click", goNext);

  if (!apiReady) {
    clientStatus.textContent = "在线采集接口尚未配置，当前无法提交答卷。";
    clientStatus.classList.add("is-warning");
  }
  checkClientStatus();

  function generateClientId() {
    if (globalThis.crypto?.randomUUID) {
      return crypto.randomUUID();
    }
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function getOrCreateClientId() {
    const key = "socioeconomic_survey30_client_id";
    try {
      const stored = localStorage.getItem(key);
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(stored || ""))) {
        return stored;
      }
      const generated = generateClientId();
      localStorage.setItem(key, generated);
      return generated;
    } catch {
      return generateClientId();
    }
  }

  function apiUrl(path) {
    return `${apiBase}${path}`;
  }

  function updateStartState() {
    startButton.disabled = !consent.checked || clientHasSubmitted || !apiReady;
    startButton.textContent = clientHasSubmitted ? "本设备已提交" : "开始作答";
  }

  function showView(name) {
    Object.entries(views).forEach(([key, view]) => {
      view.hidden = key !== name;
    });
  }

  function startSurvey() {
    if (!consent.checked || !apiReady || clientHasSubmitted) {
      return;
    }
    currentIndex = 0;
    answers = new Array(questions.length).fill(null);
    startedAt = new Date();
    submissionInFlight = false;
    questionStatus.textContent = "";
    showView("question");
    renderQuestion();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderQuestion() {
    const question = questions[currentIndex];
    questionIndex.textContent = `问题 ${String(currentIndex + 1).padStart(2, "0")}`;
    questionTitle.textContent = question.text;
    questionStatus.textContent = "";
    optionList.textContent = "";

    options.forEach((option, optionIndex) => {
      const label = document.createElement("label");
      label.className = `option${option.uncertain ? " is-uncertain" : ""}`;

      const input = document.createElement("input");
      input.type = "radio";
      input.name = "survey30-answer";
      input.value = String(optionIndex);
      input.checked = answers[currentIndex] === optionIndex;
      input.addEventListener("change", () => {
        answers[currentIndex] = optionIndex;
        questionStatus.textContent = "";
      });

      const marker = document.createElement("span");
      marker.className = "option-marker";
      marker.textContent = String.fromCharCode(65 + optionIndex);

      const text = document.createElement("span");
      text.className = "option-label";
      text.textContent = option.label;
      label.append(input, marker, text);
      optionList.appendChild(label);
    });

    progressLabel.textContent = `第 ${currentIndex + 1} / ${questions.length} 题`;
    const percent = Math.round(((currentIndex + 1) / questions.length) * 100);
    progressPercent.textContent = `${percent}%`;
    progressBar.style.width = `${percent}%`;
    backButton.disabled = currentIndex === 0;
    nextButton.disabled = false;
    nextButton.textContent = currentIndex === questions.length - 1 ? "提交答卷" : "下一题";
    questionTitle.focus({ preventScroll: true });
  }

  function goBack() {
    if (currentIndex === 0) {
      return;
    }
    currentIndex -= 1;
    renderQuestion();
  }

  function goNext() {
    if (answers[currentIndex] === null) {
      questionStatus.textContent = "请选择一个选项后再继续。";
      optionList.querySelector("input")?.focus();
      return;
    }
    if (currentIndex < questions.length - 1) {
      currentIndex += 1;
      renderQuestion();
      return;
    }
    submitAnswers();
  }

  async function submitAnswers() {
    if (submissionInFlight) {
      return;
    }
    if (answers.some((answer) => answer === null)) {
      const missing = answers.findIndex((answer) => answer === null);
      currentIndex = missing;
      renderQuestion();
      questionStatus.textContent = "还有题目尚未作答，请完成后再提交。";
      return;
    }

    submissionInFlight = true;
    nextButton.disabled = true;
    nextButton.textContent = "正在提交…";
    questionStatus.textContent = "";

    const completedAt = new Date();
    const payload = {
      surveyVersion: meta.surveyVersion,
      consent: true,
      consentVersion: meta.consentVersion,
      answers: answers.slice(),
      startedAt: (startedAt || completedAt).toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: Math.max(0, completedAt.getTime() - (startedAt || completedAt).getTime()),
    };

    try {
      const response = await fetch(apiUrl("/api/survey30/results"), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Client-Id": clientId },
        credentials: "omit",
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));

      if (response.status === 201) {
        clientHasSubmitted = true;
        complete("感谢参与。你的答案已匿名保存，并计入公开汇总统计。");
        return;
      }
      if (response.status === 409) {
        clientHasSubmitted = true;
        complete("本设备已提交过本版调查，本次不会重复入库。你仍可查看汇总统计。");
        return;
      }
      throw new Error(data.message || `提交失败（HTTP ${response.status}）`);
    } catch (error) {
      console.error(error);
      questionStatus.textContent = `${error.message || "网络连接失败"}，请检查网络后重试。`;
      nextButton.textContent = "重试提交";
    } finally {
      submissionInFlight = false;
      nextButton.disabled = false;
    }
  }

  function complete(message) {
    completeMessage.textContent = message;
    showView("complete");
    document.getElementById("complete-title").focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function checkClientStatus() {
    if (!apiReady) {
      updateStartState();
      return;
    }
    try {
      const response = await fetch(apiUrl("/api/survey30/client-status"), {
        headers: { "X-Client-Id": clientId },
        credentials: "omit",
        cache: "no-store",
      });
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      if (data.submitted) {
        clientHasSubmitted = true;
        clientStatus.textContent = "本设备已提交过本版调查。每个设备每版只能成功提交一次。";
        clientStatus.classList.add("is-warning");
      }
    } catch (error) {
      console.warn("无法读取提交状态", error);
    } finally {
      updateStartState();
    }
  }
})();
