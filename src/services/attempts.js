const bcrypt = require("bcryptjs");
const { query, tx } = require("../db");
const config = require("../config");
const { generatePassword, generateToken, nameFromEmail } = require("../util");

const BCRYPT_ROUNDS = 10;

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/** All-or-nothing: the selected set must equal the correct set exactly. */
function isAnswerCorrect(question, optionIds) {
  const correct = question.options.filter((o) => o.is_correct).map((o) => o.id);
  return optionIds.length > 0 && sameSet(correct, optionIds);
}

/**
 * Create (or refresh) an invitation for a participant and return the plaintext
 * password — the only time it exists unhashed. Refuses if they already started.
 * `name` may be empty: new invitations then derive one from the email, and
 * existing ones keep the name they have.
 */
async function upsertInvitation(quizId, { email, name }) {
  const password = generatePassword();
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  // ON CONFLICT keeps two simultaneous invites for the same email from erroring.
  const { rows: created } = await query(
    `INSERT INTO invitations (quiz_id, email, name, token, password_hash)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (quiz_id, email) DO NOTHING RETURNING *`,
    [quizId, email, name || nameFromEmail(email), generateToken(), hash]
  );
  if (created[0]) return { invitation: created[0], password };

  const { rows: refreshed } = await query(
    `UPDATE invitations SET password_hash=$3, name=COALESCE(NULLIF($4,''), name),
       invited_at=now(), email_status='pending', email_error=NULL
     WHERE quiz_id=$1 AND email=$2 AND status='invited' RETURNING *`,
    [quizId, email, hash, name || ""]
  );
  if (refreshed[0]) return { invitation: refreshed[0], password, resent: true };

  const { rows: existing } = await query("SELECT * FROM invitations WHERE quiz_id=$1 AND email=$2", [quizId, email]);
  const inv = existing[0];
  return { skipped: true, reason: inv?.status === "submitted" ? "already submitted" : "already in progress", invitation: inv };
}

async function setEmailStatus(invitationId, status, error = null) {
  await query("UPDATE invitations SET email_status=$2, email_error=$3 WHERE id=$1", [
    invitationId,
    status,
    error ? String(error).slice(0, 500) : null,
  ]);
}

async function getInvitationByToken(token) {
  const { rows } = await query(
    `SELECT i.*, q.title AS quiz_title, q.description AS quiz_description,
            q.duration_minutes, q.status AS quiz_status, q.show_results,
            (extract(epoch FROM now()) * 1000)::float8 AS db_now_ms,
            (SELECT count(*) FROM questions WHERE quiz_id=q.id)::int AS question_count
     FROM invitations i JOIN quizzes q ON q.id=i.quiz_id WHERE i.token=$1`,
    [token]
  );
  return rows[0] || null;
}

async function checkPassword(invitation, password) {
  return bcrypt.compare(String(password || ""), invitation.password_hash);
}

/**
 * Record a successful sign-in and return a fresh session key. Storing a new key
 * invalidates whichever browser held the previous one (one browser per link).
 */
async function claimSession(invitationId) {
  const key = require("crypto").randomBytes(24).toString("base64url");
  await query(
    `UPDATE invitations SET session_key=$2, sign_in_count=sign_in_count+1, last_sign_in_at=now() WHERE id=$1`,
    [invitationId, key]
  );
  return key;
}

async function releaseSession(invitationId, key) {
  await query("UPDATE invitations SET session_key=NULL WHERE id=$1 AND session_key=$2", [invitationId, key]);
}

async function startAttempt(invitationId) {
  return tx(async (client) => {
    // Waits for an in-flight quiz save (updateQuiz holds FOR UPDATE on the quiz).
    await client.query(
      "SELECT 1 FROM quizzes WHERE id=(SELECT quiz_id FROM invitations WHERE id=$1) FOR SHARE",
      [invitationId]
    );
    const { rows } = await client.query(
      `UPDATE invitations i SET status='in_progress', started_at=now(),
          deadline_at = now() + make_interval(mins => q.duration_minutes)
       FROM quizzes q
       WHERE i.id=$1 AND q.id=i.quiz_id AND i.status='invited'
       RETURNING i.*`,
      [invitationId]
    );
    return rows[0] || null;
  });
}

/**
 * Deadlines are written with the database clock (now() in startAttempt), so
 * compare against the database clock too (`db_now_ms`, selected alongside the
 * row). Mixing in the app server's clock made timers and the grace period drift
 * whenever the two machines' clocks differ.
 */
const clockOf = (invitation) => (invitation.db_now_ms != null ? Number(invitation.db_now_ms) : Date.now());

function isPastGrace(invitation) {
  return Boolean(
    invitation.deadline_at &&
    clockOf(invitation) > new Date(invitation.deadline_at).getTime() + config.submitGraceSeconds * 1000
  );
}

/**
 * Save answers for an in-progress attempt. `answers` is { questionId: [optionId] }.
 * Invalid option ids are dropped; single/yes-no answers are capped to one choice.
 */
async function saveAnswers(invitation, answers, client) {
  const run = client || { query };
  const { rows: qs } = await run.query(
    `SELECT q.id, q.type, array_agg(o.id) AS option_ids
     FROM questions q JOIN options o ON o.question_id=q.id
     WHERE q.quiz_id=$1 GROUP BY q.id`,
    [invitation.quiz_id]
  );
  const byId = new Map(qs.map((q) => [q.id, q]));
  for (const [qidRaw, selected] of Object.entries(answers || {})) {
    const q = byId.get(Number(qidRaw));
    if (!q) continue;
    let ids = (Array.isArray(selected) ? selected : [selected])
      .map(Number)
      .filter((id) => q.option_ids.includes(id));
    ids = [...new Set(ids)];
    if (q.type !== "multiple") ids = ids.slice(0, 1);
    await run.query(
      `INSERT INTO answers (invitation_id, question_id, option_ids, updated_at)
       VALUES ($1,$2,$3,now())
       ON CONFLICT (invitation_id, question_id)
       DO UPDATE SET option_ids=EXCLUDED.option_ids, updated_at=now()`,
      [invitation.id, q.id, ids]
    );
  }
}

/**
 * Score and lock an attempt. Safe to call repeatedly / concurrently.
 * When `auto` is true (timer expired) the submit time is capped at the deadline.
 */
async function finalizeAttempt(invitationId, { auto = false, answers = null } = {}) {
  return tx(async (client) => {
    const { rows } = await client.query(
      "SELECT *, (extract(epoch FROM now()) * 1000)::float8 AS db_now_ms FROM invitations WHERE id=$1 FOR UPDATE",
      [invitationId]
    );
    const inv = rows[0];
    if (!inv || inv.status !== "in_progress") return inv;

    if (answers && !isPastGrace(inv)) await saveAnswers(inv, answers, client);

    const { rows: qs } = await client.query("SELECT id FROM questions WHERE quiz_id=$1", [inv.quiz_id]);
    const { rows: os } = await client.query(
      `SELECT o.id, o.question_id, o.is_correct FROM options o
       JOIN questions q ON q.id=o.question_id WHERE q.quiz_id=$1`,
      [inv.quiz_id]
    );
    const questions = new Map(qs.map((q) => [q.id, { id: q.id, options: [] }]));
    for (const o of os) questions.get(o.question_id).options.push(o);

    const { rows: saved } = await client.query(
      "SELECT question_id, option_ids FROM answers WHERE invitation_id=$1",
      [inv.id]
    );
    let score = 0;
    for (const a of saved) {
      const q = questions.get(a.question_id);
      if (!q) continue;
      const ok = isAnswerCorrect(q, a.option_ids);
      if (ok) score++;
      await client.query(
        "UPDATE answers SET is_correct=$3 WHERE invitation_id=$1 AND question_id=$2",
        [inv.id, a.question_id, ok]
      );
    }

    const expired = new Date(inv.deadline_at).getTime() <= clockOf(inv);
    const wasAuto = auto || expired;
    const { rows: done } = await client.query(
      `UPDATE invitations SET status='submitted', score=$2, max_score=$3, auto_submitted=$4,
         submitted_at = CASE WHEN $4 THEN LEAST(now(), deadline_at) ELSE now() END
       WHERE id=$1 RETURNING *`,
      [inv.id, score, questions.size, wasAuto]
    );
    return done[0];
  });
}

/** Auto-submit every attempt whose timer ran out (browser closed, offline, etc.). */
async function sweepExpired() {
  const { rows } = await query(
    `SELECT id FROM invitations WHERE status='in_progress'
       AND deadline_at < now() - make_interval(secs => $1)`,
    [config.submitGraceSeconds]
  );
  for (const r of rows) {
    try {
      await finalizeAttempt(r.id, { auto: true });
    } catch (err) {
      console.error("[sweeper] failed to finalize", r.id, err.message);
    }
  }
  return rows.length;
}

/**
 * Serverless replacement for the sweeper timer: run the sweep at most every 20 s
 * per instance, before a request is handled. (Expired attempts are also finalized
 * by any request for that invitation and on submit, so this only keeps admin
 * pages up to date.)
 */
let lastSweep = 0;
async function sweepIfDue(now = Date.now()) {
  if (now - lastSweep < 20 * 1000) return 0;
  lastSweep = now;
  try {
    return await sweepExpired();
  } catch (e) {
    console.error("[sweeper]", e.message);
    return 0;
  }
}

function startSweeper() {
  const run = () => sweepExpired().catch((e) => console.error("[sweeper]", e.message));
  run();
  return setInterval(run, 20 * 1000).unref();
}

async function getAnswers(invitationId) {
  const { rows } = await query(
    "SELECT question_id, option_ids, is_correct FROM answers WHERE invitation_id=$1",
    [invitationId]
  );
  return new Map(rows.map((r) => [r.question_id, r]));
}

/** Ranked list of finished attempts: highest score first, faster time breaks ties. */
async function rankedResults(quizId) {
  const { rows } = await query(
    `SELECT i.*,
       EXTRACT(EPOCH FROM (i.submitted_at - i.started_at))::int AS seconds_taken,
       RANK() OVER (ORDER BY i.score DESC, (i.submitted_at - i.started_at) ASC) AS rank
     FROM invitations i
     WHERE i.quiz_id=$1 AND i.status='submitted'
     ORDER BY rank, i.submitted_at`,
    [quizId]
  );
  return rows;
}

/** Wipe an attempt so the person can start again with the same link and password. */
async function resetAttempt(invitationId) {
  await tx(async (client) => {
    await client.query("SELECT 1 FROM invitations WHERE id=$1 FOR UPDATE", [invitationId]);
    await client.query("DELETE FROM answers WHERE invitation_id=$1", [invitationId]);
    await client.query(
      `UPDATE invitations SET status='invited', started_at=NULL, deadline_at=NULL, submitted_at=NULL,
         score=NULL, max_score=NULL, auto_submitted=false WHERE id=$1`,
      [invitationId]
    );
  });
}

/**
 * How submitted participants did on each question: { questions: Map(qid → {correct}),
 * options: Map(optionId → picks), submitted }. Unanswered counts as incorrect.
 */
async function questionStats(quizId) {
  const [{ rows: qs }, { rows: os }, { rows: n }] = await Promise.all([
    query(
      `SELECT a.question_id, count(*) FILTER (WHERE a.is_correct)::int AS correct
       FROM answers a JOIN invitations i ON i.id=a.invitation_id
       WHERE i.quiz_id=$1 AND i.status='submitted' GROUP BY a.question_id`,
      [quizId]
    ),
    query(
      `SELECT o.option_id, count(*)::int AS picks
       FROM answers a JOIN invitations i ON i.id=a.invitation_id, unnest(a.option_ids) AS o(option_id)
       WHERE i.quiz_id=$1 AND i.status='submitted' GROUP BY o.option_id`,
      [quizId]
    ),
    query("SELECT count(*)::int AS n FROM invitations WHERE quiz_id=$1 AND status='submitted'", [quizId]),
  ]);
  return {
    submitted: n[0].n,
    questions: new Map(qs.map((r) => [r.question_id, r])),
    options: new Map(os.map((r) => [r.option_id, r.picks])),
  };
}

async function listInvitations(quizId) {
  const { rows } = await query(
    `SELECT i.*,
       (SELECT count(*) FROM answers a WHERE a.invitation_id=i.id AND cardinality(a.option_ids) > 0)::int AS answered_count
     FROM invitations i WHERE quiz_id=$1
     ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'invited' THEN 1 ELSE 2 END, invited_at DESC`,
    [quizId]
  );
  return rows;
}

async function closeQuiz(quizId) {
  await query("UPDATE quizzes SET status='closed', updated_at=now() WHERE id=$1", [quizId]);
  const { rows } = await query(
    "SELECT id FROM invitations WHERE quiz_id=$1 AND status='in_progress'",
    [quizId]
  );
  for (const r of rows) await finalizeAttempt(r.id, { auto: true });
  return rows.length;
}

module.exports = {
  isAnswerCorrect,
  upsertInvitation,
  setEmailStatus,
  getInvitationByToken,
  checkPassword,
  claimSession,
  releaseSession,
  startAttempt,
  saveAnswers,
  finalizeAttempt,
  isPastGrace,
  clockOf,
  sweepExpired,
  startSweeper,
  sweepIfDue,
  getAnswers,
  rankedResults,
  listInvitations,
  resetAttempt,
  questionStats,
  closeQuiz,
};
