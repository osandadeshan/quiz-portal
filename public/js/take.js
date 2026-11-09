/* Quiz-taking experience */
(function () {
  "use strict";
  const { icon, h, toast, csrf } = window.UI;
  const data = JSON.parse(document.getElementById("quiz-data").textContent);
  const questions = data.questions;
  const total = questions.length;
  const base = `/q/${data.token}`;
  const clockOffset = data.serverNow - Date.now();
  const now = () => Date.now() + clockOffset;
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(`quiz:${data.token}:${k}`)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(`quiz:${data.token}:${k}`, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  const answers = {}; // qid -> [optionId]
  for (const [qid, ids] of Object.entries(data.answers || {})) if (ids && ids.length) answers[qid] = ids.map(Number);
  const flagged = new Set(store.get("flags", []));
  let current = Math.min(Math.max(0, store.get("current", 0)), total - 1);
  let submitting = false;

  const $ = (id) => document.getElementById(id);
  const el = {
    counter: $("q-counter"), text: $("q-text"), hint: $("q-hint"), choices: $("choices"),
    prev: $("prev-btn"), next: $("next-btn"), flag: $("flag-btn"),
    grid: $("nav-grid"), navSummary: $("nav-summary"), answeredLabel: $("answered-label"),
    progress: $("progress-bar"), timer: $("timer"), timerText: $("timer-text"), saveState: $("save-state"),
    modal: $("submit-modal"), overlay: $("overlay"),
  };

  const HINTS = {
    single: "Select one answer.",
    yesno: "Select Yes or No.",
    multiple: "Select all answers that apply.",
  };

  const isAnswered = (q) => (answers[q.id] || []).length > 0;
  const answeredCount = () => questions.filter(isAnswered).length;

  // ---------- Rendering ----------
  function renderQuestion() {
    const q = questions[current];
    el.counter.textContent = `Question ${current + 1} of ${total}`;
    el.text.textContent = q.text;
    el.hint.innerHTML = `${icon(q.type === "multiple" ? "checkSquare" : q.type === "yesno" ? "toggle" : "radio", 14)} `;
    el.hint.appendChild(document.createTextNode(HINTS[q.type]));
    el.choices.className = "choices" + (q.type === "yesno" ? " yesno" : "");
    el.choices.innerHTML = "";
    const selected = new Set(answers[q.id] || []);
    const inputType = q.type === "multiple" ? "checkbox" : "radio";
    q.options.forEach((o, i) => {
      const input = h("input", { type: inputType, name: `q-${q.id}`, value: String(o.id), "data-opt": String(o.id) });
      input.checked = selected.has(o.id);
      el.choices.appendChild(
        h("label", { class: "choice" }, [
          input,
          h("span", { class: `mark ${inputType === "checkbox" ? "box" : "radio"}`, html: icon("check", 14) }),
          h("span", { text: o.text }),
          i < 9 ? h("span", { class: "key", text: String(i + 1), "aria-hidden": "true" }) : null,
        ])
      );
    });
    el.prev.disabled = current === 0;
    const last = current === total - 1;
    el.next.innerHTML = last ? `${icon("send", 16)} <span>Review &amp; submit</span>` : `<span>Next</span> ${icon("arrowRight", 16)}`;
    el.flag.setAttribute("aria-pressed", String(flagged.has(q.id)));
    el.flag.querySelector("span").textContent = flagged.has(q.id) ? "Marked for review" : "Mark for review";
    store.set("current", current);
    renderNav();
  }

  function renderNav() {
    el.grid.innerHTML = "";
    questions.forEach((q, i) => {
      const cls = ["nav-btn"];
      if (isAnswered(q)) cls.push("answered");
      if (i === current) cls.push("current");
      if (flagged.has(q.id)) cls.push("flagged");
      const state = isAnswered(q) ? "answered" : "not answered";
      el.grid.appendChild(h("button", { type: "button", class: cls.join(" "), "data-goto": String(i), "aria-label": `Question ${i + 1}, ${state}${flagged.has(q.id) ? ", marked for review" : ""}`, "aria-current": i === current ? "step" : null, text: String(i + 1) }));
    });
    const n = answeredCount();
    el.navSummary.textContent = `${n} of ${total} answered${flagged.size ? ` · ${flagged.size} marked` : ""}`;
    el.answeredLabel.textContent = `${n} of ${total} answered`;
    el.progress.style.width = `${Math.round((n / total) * 100)}%`;
  }

  function go(i) {
    if (i < 0 || i >= total) return;
    current = i;
    renderQuestion();
    $("navigator").classList.remove("open");
    window.scrollTo({ top: 0, behavior: "smooth" });
    // Move focus to the new question so screen readers announce it.
    el.text.focus({ preventScroll: true });
  }
  el.text.setAttribute("tabindex", "-1");

  // ---------- Answer handling ----------
  el.choices.addEventListener("change", (e) => {
    const q = questions[current];
    const inputs = [...el.choices.querySelectorAll("input")];
    answers[q.id] = inputs.filter((i) => i.checked).map((i) => Number(i.value));
    if (!answers[q.id].length) delete answers[q.id];
    pending.add(q.id);
    scheduleSave();
    renderNav();
  });

  // Allow un-selecting a radio by clicking it again.
  el.choices.addEventListener("click", (e) => {
    const label = e.target.closest(".choice");
    if (!label) return;
    const input = label.querySelector("input");
    if (input.type !== "radio") return;
    if (input.checked && label.dataset.wasChecked === "1") {
      e.preventDefault();
      input.checked = false;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  el.choices.addEventListener("pointerdown", (e) => {
    const label = e.target.closest(".choice");
    if (label) label.dataset.wasChecked = label.querySelector("input").checked ? "1" : "0";
  });

  // ---------- Autosave ----------
  const pending = new Set();
  let saveTimer = null;
  let saving = false;
  let retryDelay = 2000;

  function setSaveState(kind) {
    const map = {
      saving: [`<span class="spinner" style="width:12px;height:12px"></span>`, "Saving…", ""],
      saved: [icon("checkCircle", 14), "All answers saved", ""],
      error: [icon("alert", 14), "Offline — retrying", "error"],
    };
    const [ic, txt, cls] = map[kind];
    el.saveState.className = `save-state ${cls}`;
    el.saveState.innerHTML = `${ic} <span class="txt">${txt}</span>`;
  }

  function scheduleSave(delay = 400) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, delay);
  }

  async function flush() {
    if (saving || !pending.size || submitting) return;
    saving = true;
    const ids = [...pending];
    pending.clear();
    const payload = {};
    ids.forEach((id) => (payload[id] = answers[id] || []));
    setSaveState("saving");
    try {
      const res = await fetch(`${base}/answers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf() },
        body: JSON.stringify({ answers: payload }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 || res.status === 401) {
        window.location.href = body.redirect || base;
        return;
      }
      if (!res.ok) throw new Error(body.error || "save failed");
      setSaveState("saved");
      retryDelay = 2000;
    } catch {
      ids.forEach((id) => pending.add(id));
      setSaveState("error");
      scheduleSave(retryDelay);
      retryDelay = Math.min(retryDelay * 2, 15000);
    } finally {
      saving = false;
      if (pending.size && el.saveState.classList.contains("error") === false) scheduleSave(200);
    }
  }
  // Session check: if this link was opened in another browser, leave right away.
  async function ping() {
    if (submitting) return;
    try {
      const res = await fetch(`${base}/ping`, { headers: { Accept: "application/json" }, cache: "no-store" });
      if (res.status === 401 || res.status === 409) {
        const body = await res.json().catch(() => ({}));
        submitting = true; // stop timers/autosave from acting on a dead session
        window.location.href = body.redirect || base;
      }
    } catch { /* offline — autosave indicator already covers this */ }
  }
  setInterval(ping, 15000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") ping(); });

  window.addEventListener("online", () => scheduleSave(0));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  window.addEventListener("beforeunload", (e) => {
    if (pending.size && !submitting) { e.preventDefault(); e.returnValue = ""; }
  });

  // ---------- Timer ----------
  let warned5 = false;
  let warned1 = false;
  const totalMs = data.deadline - now();
  function fmtTime(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return hh ? `${hh}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
  }
  function tick() {
    const left = data.deadline - now();
    el.timerText.textContent = fmtTime(left);
    el.timer.classList.toggle("warn", left <= 5 * 60000 && left > 60000);
    el.timer.classList.toggle("danger", left <= 60000);
    el.timer.setAttribute("aria-label", `Time remaining ${fmtTime(left)}`);
    if (!warned5 && left <= 5 * 60000 && left > 60000 && totalMs > 6 * 60000) {
      warned5 = true;
      toast("5 minutes left", "warning", 5000);
    }
    if (!warned1 && left <= 60000 && left > 0 && totalMs > 90000) {
      warned1 = true;
      toast("1 minute left — your answers will be submitted automatically", "danger", 6000);
    }
    if (left <= 0) {
      clearInterval(timerId);
      submit(true);
    }
  }
  const timerId = setInterval(tick, 250);

  // ---------- Submit ----------
  async function submit(auto) {
    if (submitting) return;
    submitting = true;
    clearTimeout(saveTimer);
    el.overlay.classList.remove("hidden");
    $("overlay-title").textContent = auto ? "Time's up!" : "Submitting your answers…";
    $("overlay-text").textContent = auto ? "Submitting the answers you've completed. Please keep this page open." : "Please keep this page open.";
    // Send every question, including cleared ones as [], so an answer removed just
    // before submitting (not yet autosaved) can't be scored from the old save.
    const finalAnswers = Object.fromEntries(questions.map((q) => [q.id, answers[q.id] || []]));
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const res = await fetch(`${base}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf() },
          body: JSON.stringify({ answers: finalAnswers, auto: Boolean(auto) }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.status === 401) {
          window.location.href = body.redirect || base;
          return;
        }
        if (res.ok) {
          try { localStorage.removeItem(`quiz:${data.token}:flags`); localStorage.removeItem(`quiz:${data.token}:current`); } catch { /* ignore */ }
          window.location.href = body.redirect || `${base}/result`;
          return;
        }
      } catch { /* network error — retry */ }
      $("overlay-text").textContent = "Connection problem — retrying. Your saved answers are safe.";
      await new Promise((r) => setTimeout(r, 3000));
    }
    window.location.href = base;
  }

  function openSubmitModal() {
    flush();
    const n = answeredCount();
    const unanswered = questions.map((q, i) => (isAnswered(q) ? null : i)).filter((i) => i !== null);
    const summary = $("submit-summary");
    const chips = $("submit-unanswered");
    chips.innerHTML = "";
    if (unanswered.length) {
      summary.textContent = `You've answered ${n} of ${total} questions. ${unanswered.length} ${unanswered.length === 1 ? "question is" : "questions are"} still unanswered and will be marked incorrect. You can't change your answers after submitting.`;
      $("submit-icon").className = "modal-icon warning";
      $("submit-icon").innerHTML = icon("alert", 22);
      unanswered.slice(0, 30).forEach((i) => chips.appendChild(h("button", { type: "button", class: "chip", style: "border:0;cursor:pointer", "data-jump": String(i), text: `Question ${i + 1}` })));
    } else {
      summary.textContent = `You've answered all ${total} questions. You can't change your answers after submitting.`;
      $("submit-icon").className = "modal-icon";
      $("submit-icon").innerHTML = icon("send", 22);
    }
    const flaggedList = questions.map((q, i) => (flagged.has(q.id) ? i + 1 : null)).filter(Boolean);
    if (flaggedList.length) {
      summary.appendChild(document.createElement("br"));
      summary.appendChild(document.createTextNode(`Marked for review: ${flaggedList.join(", ")}.`));
    }
    el.modal.returnValue = "";
    el.modal.showModal();
  }
  el.modal.addEventListener("close", () => { if (el.modal.returnValue === "ok") submit(false); });
  $("submit-unanswered").addEventListener("click", (e) => {
    const b = e.target.closest("[data-jump]");
    if (!b) return;
    el.modal.close();
    go(Number(b.dataset.jump));
  });

  // ---------- Controls ----------
  el.prev.addEventListener("click", () => go(current - 1));
  el.next.addEventListener("click", () => (current === total - 1 ? openSubmitModal() : go(current + 1)));
  $("finish-btn").addEventListener("click", openSubmitModal);
  el.grid.addEventListener("click", (e) => {
    const b = e.target.closest("[data-goto]");
    if (b) go(Number(b.dataset.goto));
  });
  el.flag.addEventListener("click", () => {
    const id = questions[current].id;
    flagged.has(id) ? flagged.delete(id) : flagged.add(id);
    store.set("flags", [...flagged]);
    renderQuestion();
  });
  $("toggle-nav").addEventListener("click", () => $("navigator").classList.toggle("open"));

  document.addEventListener("keydown", (e) => {
    if (el.modal.open || submitting || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowRight" && current < total - 1) { e.preventDefault(); go(current + 1); }
    else if (e.key === "ArrowLeft" && current > 0) { e.preventDefault(); go(current - 1); }
    else if (/^[1-9]$/.test(e.key)) {
      const inputs = el.choices.querySelectorAll("input");
      const input = inputs[Number(e.key) - 1];
      if (!input) return;
      if (input.type === "checkbox") input.checked = !input.checked;
      else input.checked = !input.checked;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });

  setSaveState("saved");
  renderQuestion();
  tick();
})();
