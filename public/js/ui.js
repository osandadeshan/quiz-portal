/* Shared UI helpers & progressive enhancements */
(function () {
  "use strict";

  const ICONS = window.ICONS || {};
  function icon(name, size = 18) {
    return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
  }

  /** Tiny element builder. attrs: text, html, class, or any attribute (null = skip). */
  function h(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "text") el.textContent = v;
      else if (k === "html") el.innerHTML = v;
      else el.setAttribute(k, v);
    }
    for (const c of [].concat(children)) if (c) el.appendChild(c);
    return el;
  }

  function toast(message, kind = "", ms = 3200) {
    const wrap = document.getElementById("toasts");
    if (!wrap) return;
    const iconName = kind === "danger" ? "xCircle" : kind === "warning" ? "alert" : "checkCircle";
    const t = h("div", { class: `toast ${kind}`, role: "status", html: icon(iconName, 16) });
    t.appendChild(document.createTextNode(message));
    wrap.appendChild(t);
    setTimeout(() => {
      t.style.transition = "opacity .25s";
      t.style.opacity = "0";
      setTimeout(() => t.remove(), 260);
    }, ms);
  }

  const csrf = () => document.querySelector('meta[name="csrf-token"]')?.content || "";

  const modal = document.getElementById("confirm-modal");
  function confirmDialog({ title, text, okText = "Confirm", danger = false }) {
    return new Promise((resolve) => {
      if (!modal || typeof modal.showModal !== "function") return resolve(window.confirm(`${title}\n\n${text || ""}`));
      modal.querySelector("[data-confirm-title]").textContent = title || "Are you sure?";
      modal.querySelector("[data-confirm-text]").textContent = text || "";
      const ok = modal.querySelector("[data-confirm-ok]");
      ok.textContent = okText;
      ok.className = `btn ${danger ? "btn-danger" : "btn-primary"}`;
      const ic = modal.querySelector("[data-confirm-icon]");
      ic.className = `modal-icon ${danger ? "danger" : "warning"}`;
      modal.returnValue = "";
      modal.showModal();
      ok.focus();
      modal.addEventListener("close", function onClose() {
        modal.removeEventListener("close", onClose);
        resolve(modal.returnValue === "ok");
      });
    });
  }

  window.UI = { icon, h, toast, csrf, confirmDialog };

  // ---------- Behaviors ----------

  // Mark a form as sent only once it really navigates: this listener is on window
  // in the bubble phase, so it runs after every other submit handler, and forms
  // that page scripts send with fetch (preventDefault) aren't marked.
  window.addEventListener("submit", (e) => {
    const form = e.target;
    if (!e.defaultPrevented && form instanceof HTMLFormElement && form.method.toLowerCase() === "post") form.dataset.submitting = "1";
  });

  // Back/forward cache: a restored page must be able to submit its forms again.
  window.addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    document.querySelectorAll("form[data-submitting]").forEach((f) => delete f.dataset.submitting);
    document.querySelectorAll("form button.loading").forEach((b) => b.classList.remove("loading"));
  });

  // Confirm before submitting forms marked with data-confirm.
  document.addEventListener("submit", async (e) => {
    const form = e.target;
    // A form is sent once: a second click, or Enter while the first submit is
    // still loading, would race it. (After a sign-in the first request replaces
    // the session, and the second copy then fails with "Session expired".)
    if (form.dataset.submitting) {
      e.preventDefault();
      return;
    }
    if (form.dataset.confirm !== undefined && !form.dataset.confirmed) {
      e.preventDefault();
      const ok = await confirmDialog({
        title: form.dataset.confirmTitle,
        text: form.dataset.confirm,
        okText: form.dataset.confirmBtn,
        danger: form.dataset.danger !== undefined,
      });
      if (ok) {
        form.dataset.confirmed = "1";
        form.requestSubmit ? form.requestSubmit() : form.submit();
      }
      return;
    }
    if (form.dataset.loading !== undefined) {
      const btn = form.querySelector("button:not([type=button])");
      if (btn) setTimeout(() => btn.classList.add("loading"), 0);
    }
  }, true);

  // ---------- Dropdown menus ----------
  // While open, a menu is moved to <body> and positioned with `position: fixed`,
  // so no scrolling or overflow-hidden container (tables, cards) can clip it.
  const GAP = 6;
  const MARGIN = 8;

  function placeMenu(d) {
    const menu = d._menu;
    const anchor = d.querySelector("summary");
    if (!menu || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    if (r.bottom < 0 || r.top > vh) return closeDropdown(d); // button scrolled away
    menu.style.maxHeight = `${vh - MARGIN * 2}px`;
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    // Align the menu's right edge with the button; fall back to left-aligned; keep on screen.
    let left = r.right - mw;
    if (left < MARGIN) left = r.left;
    left = Math.max(MARGIN, Math.min(left, vw - mw - MARGIN));
    // Open below; flip above when there isn't room; otherwise pin inside the viewport.
    let top = r.bottom + GAP;
    if (top + mh > vh - MARGIN) {
      top = r.top - GAP - mh >= MARGIN ? r.top - GAP - mh : Math.max(MARGIN, vh - MARGIN - mh);
    }
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }

  function openDropdown(d) {
    const menu = d.querySelector(":scope > .dropdown-menu");
    if (!menu) return;
    document.querySelectorAll("details.dropdown[open]").forEach((o) => o !== d && closeDropdown(o));
    d._menu = menu;
    menu._owner = d;
    menu.classList.add("floating");
    document.body.appendChild(menu);
    placeMenu(d);
    d.querySelector("summary").setAttribute("aria-expanded", "true");
  }

  function closeDropdown(d) {
    const menu = d._menu;
    if (menu) {
      menu.classList.remove("floating");
      menu.style.cssText = "";
      d.appendChild(menu);
      d._menu = null;
    }
    d.querySelector("summary")?.setAttribute("aria-expanded", "false");
    if (d.open) d.open = false;
  }

  document.querySelectorAll("details.dropdown > summary").forEach((s) => {
    s.setAttribute("aria-haspopup", "menu");
    s.setAttribute("aria-expanded", "false");
  });
  // `toggle` doesn't bubble, so listen in the capture phase.
  document.addEventListener("toggle", (e) => {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement) || !d.classList.contains("dropdown")) return;
    d.open ? openDropdown(d) : closeDropdown(d);
  }, true);

  const openDropdowns = () => document.querySelectorAll("details.dropdown[open]");
  document.addEventListener("click", (e) => {
    openDropdowns().forEach((d) => {
      const inMenu = d._menu && d._menu.contains(e.target);
      if (inMenu && e.target.closest(".menu-item")) {
        // Let the item's own action (link, form submit, confirm) run first.
        setTimeout(() => closeDropdown(d), 0);
      } else if (!inMenu && !d.contains(e.target)) {
        closeDropdown(d);
      }
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    openDropdowns().forEach((d) => {
      closeDropdown(d);
      d.querySelector("summary")?.focus();
    });
  });
  window.addEventListener("resize", () => openDropdowns().forEach(placeMenu));
  document.addEventListener("scroll", (e) => {
    openDropdowns().forEach((d) => {
      if (d._menu && d._menu.contains(e.target)) return; // scrolling inside the menu
      placeMenu(d);
    });
  }, true);

  document.addEventListener("click", async (e) => {
    const t = e.target;

    const copy = t.closest("[data-copy]");
    if (copy) {
      try {
        await navigator.clipboard.writeText(copy.dataset.copy);
        toast("Copied to clipboard");
      } catch {
        toast("Couldn't copy — select the text and copy it manually", "warning");
      }
      return;
    }

    const toggle = t.closest("[data-toggle-password]");
    if (toggle) {
      const input = document.getElementById(toggle.dataset.togglePassword);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      toggle.innerHTML = icon(show ? "eyeOff" : "eye", 16);
      toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
      input.focus();
      return;
    }

    const gen = t.closest("[data-generate-password]");
    if (gen) {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
      const arr = new Uint32Array(12);
      crypto.getRandomValues(arr);
      document.getElementById(gen.dataset.generatePassword).value = Array.from(arr, (n) => chars[n % chars.length]).join("");
      return;
    }

    if (t.closest("[data-dismiss]")) {
      t.closest(".alert")?.remove();
      return;
    }

    if (t.closest("[data-back]") && history.length > 1) {
      e.preventDefault();
      history.back();
      return;
    }

    const opener = t.closest("[data-open-dialog]");
    if (opener) {
      document.getElementById(opener.dataset.openDialog)?.showModal();
      return;
    }
    const closer = t.closest("[data-close-dialog]");
    if (closer) {
      closer.closest("dialog")?.close();
      return;
    }

    // Clickable table rows (ignore clicks on inner links/buttons).
    const row = t.closest("tr[data-href]");
    if (row && !t.closest("a, button, summary, details, form")) {
      window.location.href = row.dataset.href;
    }
  });

  // Share buttons on the invitation panel: mark the person as shared once used.
  document.addEventListener("click", (e) => {
    const share = e.target.closest("[data-share]");
    if (!share) return;
    const row = share.closest("[data-share-row]");
    if (row && !row.classList.contains("shared")) {
      row.classList.add("shared");
      const status = row.querySelector("[data-share-status]");
      if (status) status.innerHTML = `${icon("check", 12)} Shared`;
      const left = document.querySelectorAll("[data-share-row]:not(.shared)").length;
      const counter = document.querySelector("[data-share-left]");
      if (counter) counter.textContent = left ? `${left} left to share` : "All shared ✓";
    }
  });

  document.querySelectorAll("dialog[data-open-on-load]").forEach((d) => d.showModal());

  // Show server timestamps in the viewer's own time zone (util.localTime).
  const timeFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  document.querySelectorAll("time[data-local]").forEach((t) => {
    const d = new Date(t.getAttribute("datetime"));
    if (!isNaN(d)) { t.textContent = timeFmt.format(d); t.title = d.toString(); }
  });

  // Live text filter: <input data-filter=".selector">; items carry data-search.
  function applyFilters() {
    const input = document.querySelector("[data-filter]");
    const selector = input ? input.dataset.filter : ".quiz-card";
    const q = input ? input.value.trim().toLowerCase() : "";
    const statusBtn = document.querySelector('[data-status-filter][aria-pressed="true"]');
    const status = statusBtn ? statusBtn.dataset.statusFilter : "all";
    let shown = 0;
    document.querySelectorAll(selector).forEach((el) => {
      const okText = !q || (el.dataset.search || "").includes(q);
      const okStatus = status === "all" || el.dataset.status === status;
      const show = okText && okStatus;
      el.classList.toggle("hidden", !show);
      if (show) shown++;
    });
    document.querySelector("[data-filter-empty]")?.classList.toggle("hidden", shown > 0);
  }
  document.querySelector("[data-filter]")?.addEventListener("input", applyFilters);
  document.querySelectorAll("[data-status-filter]").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("[data-status-filter]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      applyFilters();
    })
  );

  // Answer review filter on the attempt page.
  document.querySelectorAll("[data-answer-filter]").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("[data-answer-filter]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      const f = b.dataset.answerFilter;
      document.querySelectorAll("[data-answer-state]").forEach((el) => el.classList.toggle("hidden", f !== "all" && el.dataset.answerState !== f));
    })
  );

  // Recipient preview on the invite form.
  const rec = document.querySelector("[data-recipients]");
  if (rec) {
    const preview = document.querySelector("[data-recipient-preview]");
    const label = document.querySelector("[data-invite-label]");
    const submit = document.querySelector("[data-invite-submit]");
    const re = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;
    const update = () => {
      // Same splitting as util.splitRecipients: commas only split a piece with several addresses.
      const entries = rec.value
        .split(/[\n;]+/)
        .flatMap((p) => ((p.match(/@/g) || []).length > 1 ? p.split(",") : [p]))
        .map((s) => s.trim())
        .filter(Boolean);
      const seen = new Set();
      let valid = 0;
      preview.innerHTML = "";
      entries.slice(0, 60).forEach((entry) => {
        const m = entry.match(/^(.*)<([^>]+)>$/);
        const email = (m ? m[2] : entry).trim().toLowerCase();
        const ok = re.test(email);
        if (ok && seen.has(email)) return;
        seen.add(email);
        if (ok) valid++;
        preview.appendChild(h("span", { class: `badge ${ok ? "badge-primary" : "badge-danger"}`, title: ok ? "" : "Not a valid email", html: icon(ok ? "user" : "alert", 12) }, [document.createTextNode(" " + (m && m[1].trim() ? `${m[1].trim()} · ${email}` : email))]));
      });
      if (entries.length > 60) preview.appendChild(h("span", { class: "badge", text: `+${entries.length - 60} more` }));
      const verb = label.dataset.verb || "Send";
      label.textContent = valid ? `${verb} ${valid} invitation${valid > 1 ? "s" : ""}` : `${verb} invitations`;
      submit.disabled = valid === 0;
    };
    rec.addEventListener("input", update);
    update();
    if (location.hash === "#invite") setTimeout(() => rec.focus(), 50);
  }
})();
