const express = require("express");
const { participantLoginLimiter } = require("../middleware");
const { asyncHandler, safeJson } = require("../util");
const attempts = require("../services/attempts");
const quizzes = require("../services/quizzes");

const router = express.Router();

/** Look up the invitation for :token and whether this browser is signed in to it. */
const loadInvite = asyncHandler(async (req, res, next) => {
  const inv = await attempts.getInvitationByToken(String(req.params.token || ""));
  if (!inv) {
    return res.status(404).render("error", {
      title: "Link not valid",
      message: "This quiz link isn't valid or was withdrawn. Check that you copied the full link from your email, or contact the person who invited you.",
      participant: true,
    });
  }
  // Expired attempts get finalized on any visit, not just by the sweeper.
  if (inv.status === "in_progress" && attempts.isPastGrace(inv)) {
    Object.assign(inv, await attempts.finalizeAttempt(inv.id, { auto: true }));
  }
  req.invite = inv;
  // Session holds { invitationId: key }; it's only valid while it matches the key
  // stored on the invitation, so a newer sign-in elsewhere signs this browser out.
  const keys = sessionKeys(req);
  const key = keys[inv.id];
  req.signedIn = Boolean(key && inv.session_key && key === inv.session_key);
  // A stale key means a newer sign-in replaced this browser (keep it so every
  // request explains why, until this browser signs in again).
  req.signedOutElsewhere = Boolean(key && !req.signedIn && inv.session_key);
  res.locals.participant = true;
  next();
});

function sessionKeys(req) {
  const k = req.session.inviteKeys;
  if (!k || typeof k !== "object" || Array.isArray(k)) req.session.inviteKeys = {};
  return req.session.inviteKeys;
}

const requireSignedIn = (req, res, next) => {
  if (req.signedIn) return next();
  const target = `/q/${req.params.token}${req.signedOutElsewhere ? "?elsewhere=1" : ""}`;
  if (req.is("json") || req.xhr || req.get("accept") === "application/json") {
    return res.status(401).json({
      error: req.signedOutElsewhere ? "This link was opened in another browser." : "Please sign in again.",
      redirect: target,
    });
  }
  return res.redirect(target);
};

const base = (req) => `/q/${req.params.token}`;

function closedPage(res, inv) {
  return res.render("take/closed", { title: "Quiz closed", inv });
}

// Sign-in page (or forward to the right step if already signed in).
router.get("/:token", loadInvite, (req, res) => {
  const inv = req.invite;
  if (req.signedIn) {
    if (inv.status === "submitted") return res.redirect(`${base(req)}/result`);
    if (inv.status === "in_progress") return res.redirect(`${base(req)}/take`);
    if (inv.quiz_status === "closed") return closedPage(res, inv);
    return res.redirect(`${base(req)}/start`);
  }
  if (inv.quiz_status === "closed" && inv.status !== "submitted") return closedPage(res, inv);
  res.render("take/login", {
    title: inv.quiz_title,
    inv,
    error: null,
    elsewhere: req.query.elsewhere === "1" || req.signedOutElsewhere,
    expired: req.query.expired === "1",
  });
});

router.post("/:token", participantLoginLimiter, loadInvite, asyncHandler(async (req, res, next) => {
  const inv = req.invite;
  const ok = await attempts.checkPassword(inv, String(req.body.password || "").trim());
  if (!ok) {
    return res.status(401).render("take/login", {
      title: inv.quiz_title,
      inv,
      error: "That password isn't right. Copy it exactly from your invitation email — it's case-sensitive.",
      elsewhere: false,
    });
  }
  const key = await attempts.claimSession(inv.id);
  const keep = { adminId: req.session.adminId, inviteKeys: { ...sessionKeys(req) } };
  req.session.regenerate((err) => {
    if (err) return next(err); // throwing here would crash the process
    if (keep.adminId) req.session.adminId = keep.adminId;
    req.session.inviteKeys = { ...keep.inviteKeys, [inv.id]: key };
    res.redirect(base(req));
  });
}));

router.post("/:token/logout", loadInvite, asyncHandler(async (req, res) => {
  const keys = sessionKeys(req);
  if (keys[req.invite.id]) await attempts.releaseSession(req.invite.id, keys[req.invite.id]);
  delete keys[req.invite.id];
  res.redirect(base(req));
}));

// Lightweight check the quiz page polls so a replaced browser is signed out promptly.
router.get("/:token/ping", loadInvite, requireSignedIn, (req, res) => {
  const inv = req.invite;
  if (inv.status !== "in_progress") return res.status(409).json({ redirect: `${base(req)}/result` });
  res.set("Cache-Control", "no-store").json({ ok: true, serverNow: Date.now() });
});

// Instructions page before the timer starts.
router.get("/:token/start", loadInvite, requireSignedIn, (req, res) => {
  const inv = req.invite;
  if (inv.status !== "invited") return res.redirect(base(req));
  if (inv.quiz_status === "closed") return closedPage(res, inv);
  res.render("take/start", { title: inv.quiz_title, inv });
});

router.post("/:token/start", loadInvite, requireSignedIn, asyncHandler(async (req, res) => {
  const inv = req.invite;
  if (inv.quiz_status === "closed" && inv.status === "invited") return closedPage(res, inv);
  if (inv.status === "invited") await attempts.startAttempt(inv.id);
  res.redirect(`${base(req)}/take`);
}));

// The quiz itself.
router.get("/:token/take", loadInvite, requireSignedIn, asyncHandler(async (req, res) => {
  const inv = req.invite;
  if (inv.status === "invited") return res.redirect(`${base(req)}/start`);
  if (inv.status === "submitted") return res.redirect(`${base(req)}/result`);

  const quiz = await quizzes.getQuizWithQuestions(inv.quiz_id);
  const saved = await attempts.getAnswers(inv.id);
  const data = {
    token: req.params.token,
    title: quiz.title,
    // Same clock as deadline_at (the database's), so the countdown can't drift.
    serverNow: attempts.clockOf(inv),
    deadline: new Date(inv.deadline_at).getTime(),
    // Correct answers are never sent to the browser.
    questions: quizzes.questionsForParticipant(quiz, inv).map((q) => ({
      id: q.id,
      type: q.type,
      text: q.text,
      options: q.options.map((o) => ({ id: o.id, text: o.text })),
    })),
    answers: Object.fromEntries([...saved].map(([qid, a]) => [qid, a.option_ids])),
  };
  res.set("Cache-Control", "no-store");
  res.render("take/quiz", { title: quiz.title, inv, quizData: safeJson(data) });
}));

// Autosave (JSON).
router.post("/:token/answers", loadInvite, requireSignedIn, asyncHandler(async (req, res) => {
  const inv = req.invite;
  if (inv.status !== "in_progress") {
    return res.status(409).json({ error: "This quiz has already been submitted.", redirect: `${base(req)}/result` });
  }
  if (attempts.isPastGrace(inv)) {
    await attempts.finalizeAttempt(inv.id, { auto: true });
    return res.status(409).json({ error: "Time is up.", redirect: `${base(req)}/result` });
  }
  await attempts.saveAnswers(inv, req.body.answers || {});
  res.json({ ok: true, serverNow: Date.now() });
}));

router.post("/:token/submit", loadInvite, requireSignedIn, asyncHandler(async (req, res) => {
  const inv = req.invite;
  if (inv.status === "in_progress") {
    await attempts.finalizeAttempt(inv.id, { auto: Boolean(req.body.auto), answers: req.body.answers });
  }
  const target = `${base(req)}/result`;
  if (req.is("json")) return res.json({ redirect: target });
  res.redirect(target);
}));

router.get("/:token/result", loadInvite, requireSignedIn, asyncHandler(async (req, res) => {
  const inv = req.invite;
  if (inv.status !== "submitted") return res.redirect(base(req));
  const quiz = await quizzes.getQuizWithQuestions(inv.quiz_id);
  const answers = await attempts.getAnswers(inv.id);
  res.set("Cache-Control", "no-store");
  quiz.questions = quizzes.questionsForParticipant(quiz, inv);
  res.render("take/result", { title: `Results · ${quiz.title}`, inv, quiz, answers });
}));

module.exports = router;
