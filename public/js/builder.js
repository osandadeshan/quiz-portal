/* Quiz builder */
(function () {
  "use strict";
  const { icon, h, toast, csrf, confirmDialog } = window.UI;
  const data = JSON.parse(document.getElementById("builder-data").textContent);
  const locked = Boolean(data.locked);
  const isNew = !data.quiz;
  let uid = 0;

  const TYPES = {
    single: { label: "Single choice", icon: "radio", hint: "Click the circle next to the one correct answer." },
    multiple: { label: "Multiple answers", icon: "checkSquare", hint: "Tick every correct answer. Participants must select all of them." },
    yesno: { label: "Yes / No", icon: "toggle", hint: "Choose the correct answer." },
  };

  function blankQuestion(type) {
    if (type === "yesno") return { _id: ++uid, type, text: "", options: [{ text: "Yes", correct: false }, { text: "No", correct: false }] };
    return { _id: ++uid, type, text: "", options: [0, 1, 2, 3].map(() => ({ text: "", correct: false })) };
  }

  // Same limits as services/quizzes.js LIMITS.
  const LIMITS = { title: 200, description: 2000, questions: 300, questionText: 2000, options: 20, optionText: 500 };

  const state = data.quiz
    ? JSON.parse(JSON.stringify(data.quiz))
    : { title: "", description: "", durationMinutes: 15, shuffleOptions: true, showResults: "full", questions: [] };
  if (state.shuffleOptions === undefined) state.shuffleOptions = true;
  if (!["full", "score", "none"].includes(state.showResults)) state.showResults = "full";
  state.questions.forEach((q) => (q._id = ++uid));
  if (!state.questions.length && !locked) state.questions.push(blankQuestion("single"));

  let errors = null; // { title, durationMinutes, description, questions, questionErrors: [] }
  let dirty = false;
  let showErrors = false;

  const $ = (s) => document.querySelector(s);
  const qWrap = $("#questions");
  const fTitle = $("#f-title");
  const fDesc = $("#f-desc");
  const fDur = $("#f-duration");

  fTitle.value = state.title;
  fDesc.value = state.description;
  fDur.value = state.durationMinutes;
  const fShuffle = $("#f-shuffle");
  fShuffle.checked = state.shuffleOptions !== false;
  fShuffle.disabled = locked;
  fShuffle.addEventListener("change", () => { state.shuffleOptions = fShuffle.checked; markDirty(); });
  // What participants see after submitting. Stays editable when questions are locked.
  document.querySelectorAll('input[name="show-results"]').forEach((r) => {
    r.checked = r.value === state.showResults;
    r.addEventListener("change", () => { if (r.checked) { state.showResults = r.value; markDirty(); } });
  });

  const markDirty = () => {
    dirty = true;
    $("#save-status").innerHTML = `${icon("edit", 14)} Unsaved changes`;
    if (showErrors) {
      errors = validate();
      renderErrorsOnly();
    }
  };

  fTitle.addEventListener("input", () => { state.title = fTitle.value; markDirty(); });
  fDesc.addEventListener("input", () => { state.description = fDesc.value; markDirty(); });
  fDur.addEventListener("input", () => { state.durationMinutes = fDur.value === "" ? "" : Number(fDur.value); markDirty(); });

  if (locked) {
    $("#locked-note").appendChild(
      h("div", { class: "alert alert-info" }, [
        h("span", { html: icon("lock", 18) }),
        h("div", { class: "alert-body", html: "<strong>Questions are locked</strong> because someone has already started this quiz. You can still change the title, description, time limit and what participants see afterwards. A new time limit applies only to people who haven't started yet. To change questions, duplicate the quiz." }),
      ])
    );
    $("#add-menu").classList.add("hidden");
    $("#import-btn").classList.add("hidden");
  }

  // ---------- Validation (mirrors the server) ----------
  function validate() {
    const e = { questionErrors: [] };
    if (!state.title.trim()) e.title = "Give your quiz a title.";
    else if (state.title.trim().length > LIMITS.title) e.title = "Keep the title under 200 characters.";
    if (state.description.trim().length > LIMITS.description) e.description = "Keep the description under 2000 characters.";
    const d = Number(state.durationMinutes);
    if (!Number.isInteger(d) || d < 1 || d > 600) e.durationMinutes = "Enter a whole number of minutes between 1 and 600.";
    if (!state.questions.length) e.questions = "Add at least one question.";
    if (state.questions.length > LIMITS.questions) e.questions = "A quiz can have at most 300 questions.";
    if (!locked) {
      state.questions.forEach((q, i) => {
        const errs = [];
        if (!q.text.trim()) errs.push("Write the question.");
        else if (q.text.trim().length > LIMITS.questionText) errs.push("Keep the question under 2000 characters.");
        const opts = q.type === "yesno" ? q.options : q.options.filter((o) => o.text.trim());
        if (opts.length < 2) errs.push("Add at least two answer options.");
        if (opts.length > LIMITS.options) errs.push("Use at most 20 options.");
        if (opts.some((o) => o.text.trim().length > LIMITS.optionText)) errs.push("Keep each option under 500 characters.");
        const lowered = opts.map((o) => o.text.trim().toLowerCase());
        if (new Set(lowered).size !== lowered.length) errs.push("Two options have the same text.");
        const c = opts.filter((o) => o.correct).length;
        if (c === 0) errs.push(q.type === "multiple" ? "Tick at least one correct answer." : "Mark the correct answer.");
        if (errs.length) e.questionErrors[i] = errs;
      });
    }
    const has = e.title || e.description || e.durationMinutes || e.questions || e.questionErrors.some(Boolean);
    return has ? e : null;
  }

  // ---------- Rendering ----------
  function renderFieldError(name, msg) {
    const field = document.querySelector(`[data-field="${name}"]`);
    if (!field) return;
    field.classList.toggle("has-error", Boolean(msg));
    let el = field.querySelector(".field-error");
    if (msg) {
      if (!el) { el = h("span", { class: "field-error" }); field.appendChild(el); }
      el.innerHTML = icon("alert", 14) + " ";
      el.appendChild(document.createTextNode(msg));
    } else if (el) el.remove();
  }

  function renderErrorsOnly() {
    renderFieldError("title", errors && errors.title);
    renderFieldError("durationMinutes", errors && errors.durationMinutes);
    renderFieldError("description", errors && errors.description);
    document.querySelectorAll(".q-card").forEach((card, i) => {
      const errs = errors && errors.questionErrors && errors.questionErrors[i];
      card.classList.toggle("has-error", Boolean(errs));
      const box = card.querySelector(".q-errors");
      box.classList.toggle("hidden", !errs);
      box.innerHTML = "";
      if (errs) box.appendChild(h("ul", {}, errs.map((m) => h("li", { text: m }))));
    });
    renderOutline();
  }

  function render(focus) {
    qWrap.innerHTML = "";
    state.questions.forEach((q, i) => qWrap.appendChild(renderQuestion(q, i)));
    $("#q-count").textContent = state.questions.length;
    if (showErrors) errors = validate();
    renderErrorsOnly();
    if (focus) {
      const el = qWrap.querySelector(focus);
      if (el) { el.focus(); if (el.setSelectionRange && el.value) el.setSelectionRange(el.value.length, el.value.length); }
    }
  }

  function renderOutline() {
    const ol = $("#outline");
    ol.innerHTML = "";
    state.questions.forEach((q, i) => {
      const bad = errors && errors.questionErrors && errors.questionErrors[i];
      ol.appendChild(
        h("li", { class: bad ? "bad" : "" }, [
          h("a", { href: `#q-${q._id}` }, [
            h("span", { class: "n", text: String(i + 1) }),
            h("span", { class: "t", text: q.text.trim() || "Untitled question" }),
          ]),
        ])
      );
    });
    $("#outline-count").textContent = `${state.questions.length} total`;
  }

  function toolBtn(action, iconName, label, disabled) {
    return h("button", { type: "button", class: "btn btn-ghost btn-icon btn-sm" + (action === "delete" ? " danger" : ""), "data-action": action, title: label, "aria-label": label, disabled: disabled ? "" : null, html: icon(iconName, 16) });
  }

  function renderQuestion(q, i) {
    const t = TYPES[q.type];
    const card = h("section", { class: "card q-card", id: `q-${q._id}`, "data-q": i });

    const seg = h("div", { class: "segmented", role: "group", "aria-label": "Answer type" },
      Object.entries(TYPES).map(([key, def]) =>
        h("button", { type: "button", "data-action": "type", "data-type": key, "aria-pressed": String(q.type === key), disabled: locked ? "" : null, title: def.label, html: `${icon(def.icon, 14)}<span>${def.label}</span>` })
      )
    );
    const tools = locked ? h("div") : h("div", { class: "q-tools" }, [
      toolBtn("up", "chevronUp", "Move up", i === 0),
      toolBtn("down", "chevronDown", "Move down", i === state.questions.length - 1),
      toolBtn("duplicate", "copy", "Duplicate question"),
      toolBtn("delete", "trash", "Delete question"),
    ]);
    card.appendChild(h("div", { class: "q-head" }, [h("span", { class: "q-num", text: `Question ${i + 1}` }), seg, tools]));

    const body = h("div", { class: "q-body" });
    const text = h("textarea", { class: "textarea q-text", rows: "2", maxlength: String(LIMITS.questionText), placeholder: "Type your question", "data-input": "text", "aria-label": `Question ${i + 1} text`, disabled: locked ? "" : null });
    text.value = q.text;
    body.appendChild(text);

    body.appendChild(h("div", { class: "opts-label" }, [
      h("span", { class: "label", text: q.type === "yesno" ? "Correct answer" : "Answer options" }),
      h("span", { class: "hint", text: t.hint }),
    ]));

    if (q.type === "yesno") {
      body.appendChild(h("div", { class: "yesno-row" }, q.options.map((o, j) =>
        h("button", { type: "button", class: "yesno-opt", "data-action": "correct", "data-o": j, "aria-pressed": String(o.correct), disabled: locked ? "" : null, html: `${icon(o.correct ? "checkCircle" : (j === 0 ? "check" : "x"), 18)} ${o.text}` })
      )));
    } else {
      const list = h("div", { class: "opts" });
      q.options.forEach((o, j) => {
        const input = h("input", { class: "input", placeholder: `Option ${j + 1}`, "data-input": "option", "data-o": j, maxlength: String(LIMITS.optionText), "aria-label": `Option ${j + 1}`, disabled: locked ? "" : null });
        input.value = o.text;
        list.appendChild(h("div", { class: "opt-row" + (o.correct ? " is-correct" : "") }, [
          h("button", { type: "button", class: "correct-toggle " + (q.type === "multiple" ? "box" : "radio"), "data-action": "correct", "data-o": j, "aria-pressed": String(o.correct), title: o.correct ? "Correct answer" : "Mark as correct", "aria-label": `Mark option ${j + 1} as correct`, disabled: locked ? "" : null, html: icon("check", 16) }),
          input,
          locked ? null : h("button", { type: "button", class: "btn btn-ghost btn-icon btn-sm", "data-action": "remove-opt", "data-o": j, title: "Remove option", "aria-label": `Remove option ${j + 1}`, disabled: q.options.length <= 2 ? "" : null, html: icon("x", 16) }),
        ]));
      });
      body.appendChild(list);
      if (!locked) body.appendChild(h("button", { type: "button", class: "btn btn-ghost btn-sm add-opt", "data-action": "add-opt", html: `${icon("plus", 14)} Add option` }));
    }
    card.appendChild(body);
    card.appendChild(h("div", { class: "q-errors hidden" }));
    return card;
  }

  // ---------- Events ----------
  qWrap.addEventListener("input", (e) => {
    const card = e.target.closest(".q-card");
    if (!card) return;
    const q = state.questions[Number(card.dataset.q)];
    if (e.target.dataset.input === "text") {
      q.text = e.target.value;
      renderOutline();
    } else if (e.target.dataset.input === "option") {
      q.options[Number(e.target.dataset.o)].text = e.target.value;
    }
    markDirty();
  });

  qWrap.addEventListener("keydown", (e) => {
    if (e.target.dataset.input !== "option") return;
    const card = e.target.closest(".q-card");
    const qi = Number(card.dataset.q);
    const q = state.questions[qi];
    const oi = Number(e.target.dataset.o);
    if (e.key === "Enter") {
      e.preventDefault();
      if (oi === q.options.length - 1) {
        if (q.options.length >= 20) return toast("A question can have at most 20 options.", "warning");
        q.options.push({ text: "", correct: false });
        markDirty();
      }
      render(`[data-q="${qi}"] [data-input="option"][data-o="${oi + 1}"]`);
    } else if (e.key === "Backspace" && e.target.value === "" && q.options.length > 2) {
      e.preventDefault();
      q.options.splice(oi, 1);
      markDirty();
      render(`[data-q="${qi}"] [data-input="option"][data-o="${Math.max(0, oi - 1)}"]`);
    }
  });

  qWrap.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn || btn.disabled) return;
    const card = btn.closest(".q-card");
    const qi = Number(card.dataset.q);
    const q = state.questions[qi];
    const action = btn.dataset.action;

    if (action === "type") {
      const type = btn.dataset.type;
      if (type === q.type) return;
      if (type === "yesno") {
        q.options = [{ text: "Yes", correct: false }, { text: "No", correct: false }];
      } else if (q.type === "yesno") {
        q.options = blankQuestion(type).options;
      } else if (type === "single") {
        let seen = false;
        q.options.forEach((o) => { if (o.correct) { if (seen) o.correct = false; seen = true; } });
      }
      q.type = type;
    } else if (action === "correct") {
      const oi = Number(btn.dataset.o);
      if (q.type === "multiple") q.options[oi].correct = !q.options[oi].correct;
      else q.options.forEach((o, j) => (o.correct = j === oi ? !o.correct : false));
    } else if (action === "add-opt") {
      if (q.options.length >= 20) return toast("A question can have at most 20 options.", "warning");
      q.options.push({ text: "", correct: false });
      markDirty();
      return render(`[data-q="${qi}"] [data-input="option"][data-o="${q.options.length - 1}"]`);
    } else if (action === "remove-opt") {
      q.options.splice(Number(btn.dataset.o), 1);
    } else if (action === "up" || action === "down") {
      const j = action === "up" ? qi - 1 : qi + 1;
      [state.questions[qi], state.questions[j]] = [state.questions[j], state.questions[qi]];
      markDirty();
      render();
      document.getElementById(`q-${q._id}`).scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    } else if (action === "duplicate") {
      const copy = JSON.parse(JSON.stringify(q));
      copy._id = ++uid;
      state.questions.splice(qi + 1, 0, copy);
      markDirty();
      render(`[data-q="${qi + 1}"] [data-input="text"]`);
      toast("Question duplicated");
      return;
    } else if (action === "delete") {
      const empty = !q.text.trim() && q.options.every((o) => !o.text.trim() || q.type === "yesno");
      if (!empty) {
        const ok = await confirmDialog({ title: `Delete question ${qi + 1}?`, text: "This question and its options will be removed.", okText: "Delete", danger: true });
        if (!ok) return;
      }
      state.questions.splice(qi, 1);
    }
    markDirty();
    render();
  });

  document.getElementById("add-menu").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-add]");
    if (!btn) return;
    state.questions.push(blankQuestion(btn.dataset.add));
    markDirty();
    render(`[data-q="${state.questions.length - 1}"] [data-input="text"]`);
    document.getElementById(`q-${state.questions[state.questions.length - 1]._id}`).scrollIntoView({ behavior: "smooth", block: "center" });
  });

  // ---------- Import from text ----------
  // Accepts plain pasted text and the old Markdown quiz files:
  //   ## 1. Question text [single|multiple|yesno]
  //   - [x] correct answer
  //   - [ ] wrong answer
  const OPTION_RE = /^\s*(?:[-*•+]|[a-hA-H][.)]|\([a-hA-H]\))\s+(.*)$/;
  const NUMBER_RE = /^\s*(?:#{2,6}\s*)?(?:(?:q|question)\s*)?\d+\s*[.):-]\s*/i;
  const TAG_RE = /\s*\[(single|multiple|yesno|yes\/no|text)\]\s*$/i;

  function parseImport(text) {
    const out = { questions: [], warnings: [], title: "" };
    let cur = null;
    let blank = false;
    const finish = () => {
      if (!cur) return;
      const n = out.questions.length + out.warnings.filter((w) => w.skipped).length + 1;
      const label = `Question ${n}`;
      if (cur.tag === "text" || cur.written) {
        out.warnings.push({ skipped: true, text: `${label} was skipped: written answers aren't supported.` });
      } else if (!cur.options.length) {
        out.warnings.push({ skipped: true, text: `${label} was skipped: no answers found under it.` });
      } else {
        let options = cur.options;
        if (options.length > LIMITS.options) {
          out.warnings.push({ text: `${label} has more than 20 answers. Only the first 20 were kept.` });
          options = options.slice(0, LIMITS.options);
        }
        const lower = options.map((o) => o.text.toLowerCase());
        const isYesNo = cur.tag === "yesno" || (options.length === 2 && lower.includes("yes") && lower.includes("no"));
        const correct = options.filter((o) => o.correct).length;
        let type = cur.tag === "multiple" || (!cur.tag && correct > 1) ? "multiple" : "single";
        if (isYesNo && lower.includes("yes") && lower.includes("no")) {
          type = "yesno";
          const yes = options.find((o) => o.text.toLowerCase() === "yes");
          const no = options.find((o) => o.text.toLowerCase() === "no");
          if (yes.correct && no.correct) out.warnings.push({ text: `${label} marks both Yes and No as correct. Only Yes was kept.` });
          options = [{ text: "Yes", correct: yes.correct }, { text: "No", correct: no.correct && !yes.correct }];
        }
        if (!correct) out.warnings.push({ text: `${label} has no correct answer marked. Mark it after importing.` });
        else if (type === "single" && correct > 1) out.warnings.push({ text: `${label} is single choice but has several correct answers.` });
        out.questions.push({ _id: ++uid, type, text: cur.text.trim(), options });
      }
      cur = null;
    };

    for (const raw of String(text || "").replace(/\r\n?/g, "\n").split("\n")) {
      const line = raw.trim();
      if (!line) { blank = true; continue; }
      if (/^#\s+/.test(line) && !out.questions.length && !cur && !out.title) { out.title = line.replace(/^#\s+/, ""); blank = false; continue; }
      if (/^correct answer\s*:/i.test(line)) { if (cur) cur.written = true; blank = false; continue; }
      const opt = line.match(OPTION_RE);
      if (opt && cur) {
        let t = opt[1].trim();
        let correct = false;
        const box = t.match(/^\[( |x|X|✓|✔)?\]\s*/);
        if (box) { correct = Boolean(box[1] && box[1] !== " "); t = t.slice(box[0].length); }
        const suffix = t.match(/\s*(?:\((?:correct|answer)\)|✓|✔)\s*$/i);
        if (suffix) { correct = true; t = t.slice(0, suffix.index); }
        if (t.trim()) cur.options.push({ text: t.trim().slice(0, LIMITS.optionText), correct });
        blank = false;
        continue;
      }
      // Question text: a numbered or heading line always starts a new question;
      // otherwise a line right below a question without answers continues it.
      const starts = NUMBER_RE.test(line) || /^#{2,6}\s/.test(line);
      if (cur && !cur.options.length && !blank && !starts) {
        cur.text += "\n" + line;
      } else {
        finish();
        let t = line.replace(NUMBER_RE, "").replace(/^#{2,6}\s*/, "");
        let tag = null;
        const m = t.match(TAG_RE);
        if (m) { tag = m[1].toLowerCase().replace("yes/no", "yesno"); t = t.slice(0, m.index); }
        cur = { text: t, tag, options: [] };
      }
      blank = false;
    }
    finish();
    return out;
  }

  const importDialog = $("#import-dialog");
  const importText = $("#import-text");
  const importSummary = $("#import-summary");
  const importOk = $("#import-ok");
  let parsed = null;
  function updateImport() {
    parsed = parseImport(importText.value);
    importSummary.innerHTML = "";
    const n = parsed.questions.length;
    importOk.disabled = n === 0;
    importOk.textContent = n ? `Add ${n} question${n === 1 ? "" : "s"}` : "Add questions";
    if (!importText.value.trim()) return;
    const counts = { single: 0, multiple: 0, yesno: 0 };
    parsed.questions.forEach((q) => counts[q.type]++);
    const parts = Object.entries(counts).filter(([, c]) => c).map(([t, c]) => `${c} ${TYPES[t].label.toLowerCase()}`);
    importSummary.appendChild(h("div", { html: `${icon(n ? "checkCircle" : "alert", 14)} ` }, [
      document.createTextNode(n ? `Found ${n} question${n === 1 ? "" : "s"}: ${parts.join(", ")}.` : "No questions found yet. Put each answer on its own line starting with - or a)."),
    ]));
    if (parsed.warnings.length) importSummary.appendChild(h("ul", {}, parsed.warnings.slice(0, 8).map((w) => h("li", { text: w.text }))));
  }
  importText.addEventListener("input", updateImport);
  $("#import-btn").addEventListener("click", () => setTimeout(() => importText.focus(), 30));
  importDialog.addEventListener("close", () => {
    if (importDialog.returnValue !== "ok" || !parsed || !parsed.questions.length) return;
    // Replace the single empty starter question instead of keeping it.
    const onlyBlank = state.questions.length === 1 && !state.questions[0].text.trim() && state.questions[0].options.every((o) => !o.text.trim() || state.questions[0].type === "yesno");
    if (onlyBlank) state.questions = [];
    const room = LIMITS.questions - state.questions.length;
    const add = parsed.questions.slice(0, Math.max(0, room));
    state.questions.push(...add);
    if (parsed.title && !state.title.trim()) { state.title = parsed.title.slice(0, LIMITS.title); fTitle.value = state.title; }
    markDirty();
    render();
    toast(add.length < parsed.questions.length ? `Added ${add.length} questions. A quiz can have at most 300.` : `Added ${add.length} question${add.length === 1 ? "" : "s"}. Check them, then save.`, add.length < parsed.questions.length ? "warning" : "");
    importText.value = "";
    updateImport();
    const first = document.getElementById(`q-${add[0]?._id}`);
    if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  // ---------- Save ----------
  const saveBtn = $("#save-btn");
  async function save() {
    showErrors = true;
    errors = validate();
    renderErrorsOnly();
    if (errors) {
      const firstBad = errors.title || errors.description || errors.durationMinutes ? document.querySelector(".has-error") : document.querySelector(".q-card.has-error");
      (firstBad || document.body).scrollIntoView({ behavior: "smooth", block: "center" });
      const n = errors.questionErrors.filter(Boolean).length;
      toast(n ? `Fix ${n} question${n > 1 ? "s" : ""} highlighted in red` : "Check the highlighted fields", "danger");
      if (errors.questions) toast(errors.questions, "danger");
      return;
    }
    saveBtn.classList.add("loading");
    try {
      const payload = {
        title: state.title,
        description: state.description,
        durationMinutes: Number(state.durationMinutes),
        shuffleOptions: state.shuffleOptions !== false,
        showResults: state.showResults,
        questions: state.questions.map((q) => ({ type: q.type, text: q.text, options: q.options.map((o) => ({ text: o.text, correct: o.correct })) })),
      };
      const res = await fetch(isNew ? "/admin/quizzes" : `/admin/quizzes/${data.quiz.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf() },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.redirect) {
        dirty = false;
        window.location.href = body.redirect;
        return;
      }
      if (body.errors) {
        errors = body.errors;
        renderErrorsOnly();
        toast("Please fix the highlighted problems", "danger");
      } else {
        toast(body.error || "Couldn't save. Check your connection and try again.", "danger");
      }
    } catch (err) {
      toast("Couldn't reach the server. Check your connection and try again.", "danger");
    }
    saveBtn.classList.remove("loading");
  }
  saveBtn.addEventListener("click", save);
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
  });
  $("#save-status").innerHTML = `<span class="hide-sm">${icon("info", 14)} Tip: press Ctrl/⌘ + S to save</span>`;

  window.addEventListener("beforeunload", (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ""; }
  });

  render();
  if (isNew) fTitle.focus();
})();
