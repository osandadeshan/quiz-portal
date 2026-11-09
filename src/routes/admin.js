const express = require("express");
const config = require("../config");
const { query } = require("../db");
const { requireAdmin, loginLimiter } = require("../middleware");
const { asyncHandler, parseRecipients, isEmail, safeJson, percent, formatDuration, csvCell, sheetDate, mapLimit } = require("../util");
const admins = require("../services/admins");
const quizzes = require("../services/quizzes");
const attempts = require("../services/attempts");
const mailer = require("../services/mailer");

const router = express.Router();

// ---------- Auth ----------

router.get("/login", asyncHandler(async (req, res) => {
  if (req.session.adminId) return res.redirect("/admin");
  if ((await admins.count()) === 0) return res.redirect("/admin/setup");
  res.render("admin/login", { title: "Sign in", email: "", error: null });
}));

router.post("/login", loginLimiter, asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;
  const admin = await admins.authenticate(email, password);
  if (!admin) {
    return res.status(401).render("admin/login", {
      title: "Sign in",
      email: email || "",
      error: "That email and password don't match. Check them and try again.",
    });
  }
  const returnTo = req.session.returnTo;
  req.session.regenerate((err) => {
    if (err) return next(err); // throwing here would crash the process
    req.session.adminId = admin.id;
    res.redirect(returnTo && returnTo.startsWith("/admin") ? returnTo : "/admin");
  });
}));

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/admin/login"));
});

// First-run: create the first admin account from the browser. Disabled in
// production, where anyone could reach it first: there the first admin comes
// from ADMIN_EMAIL / ADMIN_PASSWORD.
function setupDisabled(res) {
  return res.status(403).render("error", {
    title: "Admin account not set up",
    message: "For security, the first admin can't be created from the browser on a live server. Set ADMIN_EMAIL and ADMIN_PASSWORD in the server's environment settings and restart the app, then sign in with them.",
    participant: true,
  });
}

router.get("/setup", asyncHandler(async (req, res) => {
  if ((await admins.count()) > 0) return res.redirect("/admin/login");
  if (config.isProd) return setupDisabled(res);
  res.render("admin/setup", { title: "Set up", values: {}, errors: {} });
}));

router.post("/setup", loginLimiter, asyncHandler(async (req, res, next) => {
  if ((await admins.count()) > 0) return res.redirect("/admin/login");
  if (config.isProd) return setupDisabled(res);
  const values = { name: (req.body.name || "").trim(), email: (req.body.email || "").trim() };
  const errors = validateAdminInput({ ...values, password: req.body.password, confirm: req.body.confirm });
  if (Object.keys(errors).length) return res.status(422).render("admin/setup", { title: "Set up", values, errors });
  const admin = await admins.create({ ...values, password: req.body.password });
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.adminId = admin.id;
    req.flash("success", `Welcome, ${admin.name}! Create your first quiz to get started.`);
    res.redirect("/admin");
  });
}));

function validateAdminInput({ name, email, password, confirm }) {
  const errors = {};
  if (!name) errors.name = "Enter a name.";
  if (!isEmail(email)) errors.email = "Enter a valid email address.";
  if (!password || password.length < admins.MIN_PASSWORD)
    errors.password = `Use at least ${admins.MIN_PASSWORD} characters.`;
  else if (confirm !== undefined && password !== confirm) errors.confirm = "Passwords don't match.";
  return errors;
}

// Everything below requires an admin session.
router.use(requireAdmin, asyncHandler(async (req, res, next) => {
  const admin = await admins.findById(req.session.adminId);
  if (!admin) {
    return req.session.destroy(() => res.redirect("/admin/login"));
  }
  req.admin = admin;
  res.locals.admin = admin;
  next();
}));

// ---------- Dashboard / quiz list ----------

router.get("/", asyncHandler(async (req, res) => {
  const list = await quizzes.listQuizzes(req.admin.id);
  const totals = list.reduce(
    (t, q) => {
      t.invited += q.invited_count;
      t.submitted += q.submitted_count;
      t.inProgress += q.in_progress_count;
      return t;
    },
    { quizzes: list.length, invited: 0, submitted: 0, inProgress: 0 }
  );
  const { rows } = await query(
    `SELECT round(avg(100.0*i.score/NULLIF(i.max_score,0)))::int AS avg
     FROM invitations i JOIN quizzes q ON q.id=i.quiz_id
     WHERE i.status='submitted' AND q.created_by=$1`,
    [req.admin.id]
  );
  totals.avg = rows[0].avg;
  res.render("admin/dashboard", { title: "Quizzes", quizzes: list, totals });
}));

// ---------- Builder ----------

router.get("/quizzes/new", (req, res) => {
  res.render("admin/builder", {
    title: "New quiz",
    builderData: safeJson({ quiz: null, locked: false }),
    quiz: null,
  });
});

router.post("/quizzes", asyncHandler(async (req, res) => {
  const { quiz, errors } = quizzes.validateQuiz(req.body || {});
  if (errors) return res.status(422).json({ errors });
  const id = await quizzes.createQuiz(quiz, req.admin.id);
  req.flash("success", "Quiz created. Invite participants whenever you're ready.");
  res.json({ redirect: `/admin/quizzes/${id}?tab=participants` });
}));

const loadQuiz = asyncHandler(async (req, res, next) => {
  const id = Number(req.params.id);
  const quiz = Number.isInteger(id) ? await quizzes.getQuiz(id) : null;
  // Quizzes are private to the admin who created them.
  if (!quiz || quiz.created_by !== req.admin.id) {
    return res.status(404).render("error", { title: "Quiz not found", message: "This quiz doesn't exist or was deleted." });
  }
  req.quiz = quiz;
  next();
});

router.get("/quizzes/:id/edit", loadQuiz, asyncHandler(async (req, res) => {
  const full = await quizzes.getQuizWithQuestions(req.quiz.id);
  const locked = await quizzes.questionsLocked(req.quiz.id);
  res.render("admin/builder", {
    title: `Edit · ${full.title}`,
    builderData: safeJson({ quiz: quizzes.toBuilderPayload(full), locked }),
    quiz: full,
  });
}));

router.post("/quizzes/:id", loadQuiz, asyncHandler(async (req, res) => {
  const { quiz, errors } = quizzes.validateQuiz(req.body || {});
  const locked = await quizzes.questionsLocked(req.quiz.id);
  // When locked the questions aren't changed, so don't block saving on their errors.
  if (errors && !(locked && !errors.title && !errors.durationMinutes && !errors.description)) {
    return res.status(422).json({ errors });
  }
  const saved = await quizzes.updateQuiz(req.quiz.id, quiz);
  req.flash("success", saved.locked ? "Quiz details saved. Questions stay locked because someone has already started." : "Quiz saved.");
  res.json({ redirect: `/admin/quizzes/${req.quiz.id}` });
}));

// ---------- Quiz detail ----------

function popDraft(req) {
  const d = req.session.inviteDraft || "";
  delete req.session.inviteDraft;
  return d;
}

router.get("/quizzes/:id", loadQuiz, asyncHandler(async (req, res) => {
  const tab = ["results", "participants", "questions"].includes(req.query.tab) ? req.query.tab : "results";
  const full = await quizzes.getQuizWithQuestions(req.quiz.id);
  const [ranked, invitations, questionStats] = await Promise.all([
    attempts.rankedResults(req.quiz.id),
    attempts.listInvitations(req.quiz.id),
    tab === "questions" ? attempts.questionStats(req.quiz.id) : null,
  ]);
  const scores = ranked.map((r) => percent(r.score, r.max_score));
  const stats = {
    invited: invitations.length,
    started: invitations.filter((i) => i.status !== "invited").length,
    submitted: ranked.length,
    avg: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    top: scores.length ? Math.max(...scores) : null,
  };
  res.render("admin/quiz", {
    title: full.title,
    quiz: full,
    tab,
    ranked,
    invitations,
    stats,
    mailConfigured: mailer.configured,
    locked: stats.started > 0,
    inviteDraft: popDraft(req),
    questionStats,
    now: Date.now(),
  });
}));

router.post("/quizzes/:id/invite", loadQuiz, asyncHandler(async (req, res) => {
  const back = `/admin/quizzes/${req.quiz.id}?tab=participants`;
  if (req.quiz.status === "closed") {
    req.flash("error", "This quiz is closed. Reopen it before inviting people.");
    return res.redirect(back);
  }
  const { rows: qc } = await query("SELECT count(*)::int AS n FROM questions WHERE quiz_id=$1", [req.quiz.id]);
  if (!qc[0].n) {
    req.flash("error", "Add questions before inviting people.");
    return res.redirect(back);
  }
  const { valid, invalid } = parseRecipients(req.body.recipients);
  if (valid.length > config.maxInvitesPerBatch) {
    req.flash("error", `That's ${valid.length} people. Invite at most ${config.maxInvitesPerBatch} at a time.`);
    req.session.inviteDraft = req.body.recipients;
    return res.redirect(back);
  }
  if (!valid.length) {
    req.flash("error", invalid.length ? `None of these look like email addresses: ${invalid.join(", ")}` : "Add at least one email address.");
    req.session.inviteDraft = req.body.recipients;
    return res.redirect(back);
  }
  await inviteRecipients(req, req.quiz, valid);
  if (invalid.length) req.flash("warning", `Ignored invalid entries: ${invalid.join(", ")}.`);
  res.redirect(back);
}));

/**
 * Ready-to-send invitation for sharing without SMTP: the same message as the
 * email, plus one-click links for the admin's own email app and WhatsApp.
 */
function shareable(entry, quiz, questionCount) {
  const msg = mailer.inviteEmail({
    name: entry.name,
    email: entry.email,
    quizTitle: quiz.title,
    questionCount,
    durationMinutes: quiz.duration_minutes,
    link: entry.link,
    password: entry.password,
  });
  const enc = encodeURIComponent;
  return {
    ...entry,
    message: msg.text,
    mailto: `mailto:${enc(entry.email)}?subject=${enc(msg.subject)}&body=${enc(msg.text)}`,
    whatsapp: `https://wa.me/?text=${enc(msg.text)}`,
  };
}

/** Create/refresh invitations, email each person, and flash a summary. */
async function inviteRecipients(req, quiz, recipients) {
  const { rows } = await query("SELECT count(*)::int AS n FROM questions WHERE quiz_id=$1", [quiz.id]);
  const questionCount = rows[0].n;
  const sent = [];
  const skipped = [];
  const manual = []; // credentials the admin must share by hand
  // A few at a time: hashing + SMTP one by one made big batches take minutes.
  const outcomes = await mapLimit(recipients, 5, async (r) => {
    const result = await attempts.upsertInvitation(quiz.id, r);
    if (result.skipped) return { r, result };
    const link = `${config.appUrl}/q/${result.invitation.token}`;
    const mail = await mailer.sendInvite(r.email, {
      name: result.invitation.name,
      quizTitle: quiz.title,
      questionCount,
      durationMinutes: quiz.duration_minutes,
      link,
      password: result.password,
    });
    await attempts.setEmailStatus(result.invitation.id, mail.status, mail.error);
    return { r, result, link, mail };
  });
  for (const { r, result, link, mail } of outcomes) {
    if (result.skipped) skipped.push(`${r.email} (${result.reason})`);
    else if (mail.status === "sent") sent.push(r.email);
    else manual.push(shareable({ email: r.email, name: result.invitation.name, link, password: result.password, reason: mail.status }, quiz, questionCount));
  }

  if (sent.length) req.flash("success", `Invitation sent to ${sent.length === 1 ? sent[0] : `${sent.length} people`}.`);
  if (skipped.length) req.flash("warning", `Skipped ${skipped.join(", ")}.`);
  if (manual.length) {
    req.flash(
      "credentials",
      manual.some((m) => m.reason === "failed")
        ? "Some emails couldn't be delivered. Send these invitations yourself:"
        : `Send ${manual.length === 1 ? "this invitation" : `these ${manual.length} invitations`} from your own email app, WhatsApp, or anywhere you like:`,
      { credentials: manual }
    );
  }
}

router.post("/quizzes/:id/duplicate", loadQuiz, asyncHandler(async (req, res) => {
  const id = await quizzes.duplicateQuiz(req.quiz.id, req.admin.id);
  req.flash("success", "Quiz duplicated. You're editing the copy.");
  res.redirect(`/admin/quizzes/${id}/edit`);
}));

router.post("/quizzes/:id/close", loadQuiz, asyncHandler(async (req, res) => {
  const n = await attempts.closeQuiz(req.quiz.id);
  req.flash("success", n ? `Quiz closed. ${n} in-progress attempt${n > 1 ? "s were" : " was"} submitted automatically.` : "Quiz closed. Links no longer open the quiz.");
  res.redirect(`/admin/quizzes/${req.quiz.id}`);
}));

router.post("/quizzes/:id/reopen", loadQuiz, asyncHandler(async (req, res) => {
  await query("UPDATE quizzes SET status='active', updated_at=now() WHERE id=$1", [req.quiz.id]);
  req.flash("success", "Quiz reopened. Invited people can use their links again.");
  res.redirect(`/admin/quizzes/${req.quiz.id}`);
}));

router.post("/quizzes/:id/delete", loadQuiz, asyncHandler(async (req, res) => {
  await query("DELETE FROM quizzes WHERE id=$1", [req.quiz.id]);
  req.flash("success", `“${req.quiz.title}” was deleted.`);
  res.redirect("/admin");
}));

router.get("/quizzes/:id/results.csv", loadQuiz, asyncHandler(async (req, res) => {
  const ranked = await attempts.rankedResults(req.quiz.id);
  const cell = csvCell;
  const lines = [["Rank", "Name", "Email", "Score", "Out of", "Percent", "Time taken", "Submitted at", "Auto-submitted"].map(cell).join(",")];
  for (const r of ranked) {
    lines.push([r.rank, r.name, r.email, r.score, r.max_score, percent(r.score, r.max_score) + "%", formatDuration(r.seconds_taken), sheetDate(r.submitted_at), r.auto_submitted ? "yes" : "no"].map(cell).join(","));
  }
  const filename = req.quiz.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "quiz";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}-results.csv"`);
  res.send("﻿" + lines.join("\r\n"));
}));

// ---------- Invitations / attempts ----------

const loadInvitation = asyncHandler(async (req, res, next) => {
  const { rows } = await query(
    `SELECT i.* FROM invitations i JOIN quizzes q ON q.id=i.quiz_id
     WHERE i.id=$1 AND q.created_by=$2`,
    [Number(req.params.id) || 0, req.admin.id]
  );
  if (!rows[0]) return res.status(404).render("error", { title: "Not found", message: "That participant no longer exists." });
  req.invitation = rows[0];
  next();
});

router.post("/invitations/:id/resend", loadInvitation, asyncHandler(async (req, res) => {
  const inv = req.invitation;
  const quiz = await quizzes.getQuiz(inv.quiz_id);
  if (quiz.status === "closed") req.flash("error", "This quiz is closed. Reopen it before re-sending invitations.");
  else await inviteRecipients(req, quiz, [{ email: inv.email, name: inv.name }]);
  res.redirect(`/admin/quizzes/${inv.quiz_id}?tab=participants`);
}));

router.post("/invitations/:id/delete", loadInvitation, asyncHandler(async (req, res) => {
  await query("DELETE FROM invitations WHERE id=$1", [req.invitation.id]);
  req.flash("success", `Removed ${req.invitation.email}. Their link no longer works.`);
  res.redirect(`/admin/quizzes/${req.invitation.quiz_id}?tab=${req.body.from === "results" ? "results" : "participants"}`);
}));

router.post("/invitations/:id/reset", loadInvitation, asyncHandler(async (req, res) => {
  await attempts.resetAttempt(req.invitation.id);
  req.flash("success", `${req.invitation.email} can now retake the quiz with their existing link and password.`);
  res.redirect(`/admin/quizzes/${req.invitation.quiz_id}?tab=participants`);
}));

router.get("/attempts/:id", loadInvitation, asyncHandler(async (req, res) => {
  const inv = req.invitation;
  const quiz = await quizzes.getQuizWithQuestions(inv.quiz_id);
  quiz.questions = quizzes.questionsForParticipant(quiz, inv); // show options in the order they saw
  const answers = await attempts.getAnswers(inv.id);
  const ranked = await attempts.rankedResults(inv.quiz_id);
  const idx = ranked.findIndex((r) => r.id === inv.id);
  res.render("admin/attempt", {
    title: `${inv.name || inv.email} · ${quiz.title}`,
    quiz,
    inv,
    answers,
    rankRow: idx >= 0 ? ranked[idx] : null,
    totalRanked: ranked.length,
    prev: idx > 0 ? ranked[idx - 1] : null,
    next: idx >= 0 && idx < ranked.length - 1 ? ranked[idx + 1] : null,
    answeredCount: [...answers.values()].filter((a) => a.option_ids.length > 0).length,
    now: Date.now(),
  });
}));

// ---------- Team & account ----------

const isOwner = (req) => req.admin.role === "owner";

/** Only the owner manages the team; others get a friendly explanation. */
function requireOwner(req, res, next) {
  if (isOwner(req)) return next();
  req.flash("error", "Only the owner of this Quiz Portal can add, remove or reset admins.");
  return res.redirect("/admin/team");
}

function renderTeam(res, req, extra = {}) {
  return admins.list().then((list) =>
    res.render("admin/team", { title: "Team", admins: list, isOwner: isOwner(req), values: {}, errors: {}, ...extra })
  );
}

router.get("/team", asyncHandler(async (req, res) => renderTeam(res, req)));

router.post("/team", requireOwner, asyncHandler(async (req, res) => {
  const values = { name: (req.body.name || "").trim(), email: (req.body.email || "").trim().toLowerCase() };
  const errors = validateAdminInput({ ...values, password: req.body.password });
  if (!errors.email) {
    const { rows } = await query("SELECT 1 FROM admins WHERE email=$1", [values.email]);
    if (rows.length) errors.email = "An admin with this email already exists.";
  }
  if (Object.keys(errors).length) {
    res.status(422);
    return renderTeam(res, req, { values, errors, openForm: true });
  }
  await admins.create({ ...values, password: req.body.password });
  req.flash("success", `${values.name} can now sign in as an admin with the password you set.`);
  res.redirect("/admin/team");
}));

/** Load another admin for an owner action; refuses the owner's own account. */
const loadOtherAdmin = asyncHandler(async (req, res, next) => {
  const other = await admins.findById(Number(req.params.id) || 0);
  if (!other) {
    req.flash("error", "That admin no longer exists.");
    return res.redirect("/admin/team");
  }
  if (other.id === req.admin.id) {
    req.flash("error", "You can't do that to your own account. Use the Account page instead.");
    return res.redirect("/admin/team");
  }
  req.otherAdmin = other;
  next();
});

router.post("/team/:id/delete", requireOwner, loadOtherAdmin, asyncHandler(async (req, res) => {
  await admins.remove(req.otherAdmin.id, req.admin.id);
  req.flash("success", `${req.otherAdmin.name} was removed. Their quizzes and results were moved to your account.`);
  res.redirect("/admin/team");
}));

router.post("/team/:id/password", requireOwner, loadOtherAdmin, asyncHandler(async (req, res) => {
  const password = await admins.resetPassword(req.otherAdmin.id);
  req.flash("password", `New password for ${req.otherAdmin.name} (${req.otherAdmin.email}). Share it with them privately. It's shown only once, and they've been signed out everywhere.`, { password });
  res.redirect("/admin/team");
}));

router.get("/account", (req, res) => {
  res.render("admin/account", { title: "Account", errors: {}, values: { name: req.admin.name } });
});

router.post("/account", asyncHandler(async (req, res) => {
  const { name, current, password, confirm } = req.body;
  const errors = {};
  if (!name || !name.trim()) errors.name = "Enter your name.";
  if (password) {
    if (!(await admins.verifyPassword(req.admin.id, current))) errors.current = "Your current password is incorrect.";
    if (password.length < admins.MIN_PASSWORD) errors.password = `Use at least ${admins.MIN_PASSWORD} characters.`;
    else if (password !== confirm) errors.confirm = "Passwords don't match.";
  }
  if (Object.keys(errors).length) {
    return res.status(422).render("admin/account", { title: "Account", errors, values: { name } });
  }
  await admins.updateProfile(req.admin.id, { name, password: password || null }, req.sessionID);
  req.flash("success", password ? "Profile and password updated. Any other browsers signed in to your account were signed out." : "Profile updated.");
  res.redirect("/admin/account");
}));

module.exports = router;
