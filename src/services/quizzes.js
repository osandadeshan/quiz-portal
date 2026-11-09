const { query, tx } = require("../db");
const { seededShuffle } = require("../util");

const TYPES = ["single", "yesno", "multiple"];
const SHOW_RESULTS = ["full", "score", "none"];
// Limits shared with public/js/builder.js.
const LIMITS = { title: 200, description: 2000, questions: 300, questionText: 2000, options: 20, optionText: 500 };
const TYPE_LABELS = {
  single: "Single choice",
  yesno: "Yes / No",
  multiple: "Multiple answers",
};

/**
 * Validate & normalize a quiz payload from the builder.
 * Returns { quiz, errors } where errors is { field: msg } plus questionErrors[i].
 */
function validateQuiz(input) {
  input = input && typeof input === "object" ? input : {};
  const errors = {};
  const questionErrors = [];

  const title = String(input.title || "").trim();
  const description = String(input.description || "").trim();
  const duration = Number(input.durationMinutes);

  if (!title) errors.title = "Give your quiz a title.";
  else if (title.length > 200) errors.title = "Keep the title under 200 characters.";
  if (description.length > LIMITS.description) errors.description = "Keep the description under 2000 characters.";
  const showResults = SHOW_RESULTS.includes(input.showResults) ? input.showResults : "full";
  if (!Number.isInteger(duration) || duration < 1 || duration > 600)
    errors.durationMinutes = "Duration must be a whole number between 1 and 600 minutes.";

  const rawQuestions = Array.isArray(input.questions) ? input.questions : [];
  if (rawQuestions.length === 0) errors.questions = "Add at least one question.";
  if (rawQuestions.length > LIMITS.questions) errors.questions = "A quiz can have at most 300 questions.";

  const questions = rawQuestions.map((q, i) => {
    q = q && typeof q === "object" ? q : {};
    const type = TYPES.includes(q.type) ? q.type : "single";
    const text = String(q.text || "").trim();
    let options = (Array.isArray(q.options) ? q.options : []).map((o) => (o && typeof o === "object" ? o : {})).map((o) => ({
      text: String(o.text || "").trim(),
      correct: Boolean(o.correct),
    }));
    if (type === "yesno") {
      const yesCorrect = options.find((o) => /^yes$/i.test(o.text))?.correct ?? options[0]?.correct;
      const noCorrect = options.find((o) => /^no$/i.test(o.text))?.correct ?? options[1]?.correct;
      options = [
        { text: "Yes", correct: Boolean(yesCorrect) },
        { text: "No", correct: Boolean(noCorrect) },
      ];
    } else {
      options = options.filter((o) => o.text);
    }

    const errs = [];
    if (!text) errs.push("Write the question.");
    else if (text.length > LIMITS.questionText) errs.push("Keep the question under 2000 characters.");
    if (options.length < 2) errs.push("Add at least two answer options.");
    if (options.length > LIMITS.options) errs.push("Use at most 20 options.");
    if (options.some((o) => o.text.length > LIMITS.optionText)) errs.push("Keep each option under 500 characters.");
    const lowered = options.map((o) => o.text.toLowerCase());
    if (new Set(lowered).size !== lowered.length) errs.push("Two options have the same text.");
    const correctCount = options.filter((o) => o.correct).length;
    if (correctCount === 0) errs.push(type === "multiple" ? "Tick at least one correct answer." : "Mark the correct answer.");
    else if (type !== "multiple" && correctCount > 1) errs.push("Only one answer can be correct.");
    if (errs.length) questionErrors[i] = errs;

    return { type, text, options };
  });

  const hasErrors = Object.keys(errors).length > 0 || questionErrors.some(Boolean);
  return {
    quiz: { title, description, durationMinutes: duration, shuffleOptions: input.shuffleOptions !== false, showResults, questions },
    errors: hasErrors ? { ...errors, questionErrors } : null,
  };
}

async function insertQuestions(client, quizId, questions) {
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const { rows } = await client.query(
      "INSERT INTO questions (quiz_id, position, type, text) VALUES ($1,$2,$3,$4) RETURNING id",
      [quizId, i, q.type, q.text]
    );
    const qid = rows[0].id;
    for (let j = 0; j < q.options.length; j++) {
      const o = q.options[j];
      await client.query(
        "INSERT INTO options (question_id, position, text, is_correct) VALUES ($1,$2,$3,$4)",
        [qid, j, o.text, o.correct]
      );
    }
  }
}

async function createQuiz(quiz, adminId) {
  return tx(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO quizzes (title, description, duration_minutes, shuffle_options, show_results, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [quiz.title, quiz.description, quiz.durationMinutes, quiz.shuffleOptions !== false, quiz.showResults || "full", adminId]
    );
    await insertQuestions(client, rows[0].id, quiz.questions);
    return rows[0].id;
  });
}

/** Questions can only be changed while nobody has started the quiz. */
async function questionsLocked(quizId) {
  const { rows } = await query(
    "SELECT 1 FROM invitations WHERE quiz_id=$1 AND status <> 'invited' LIMIT 1",
    [quizId]
  );
  return rows.length > 0;
}

async function updateQuiz(quizId, quiz) {
  return tx(async (client) => {
    // Lock the quiz row. startAttempt takes a FOR SHARE lock on it first, so
    // nobody can start while questions are being replaced (and vice versa).
    await client.query("SELECT 1 FROM quizzes WHERE id=$1 FOR UPDATE", [quizId]);
    const { rows: started } = await client.query(
      "SELECT 1 FROM invitations WHERE quiz_id=$1 AND status <> 'invited' LIMIT 1",
      [quizId]
    );
    const locked = started.length > 0;
    await client.query(
      `UPDATE quizzes SET title=$2, description=$3, duration_minutes=$4, show_results=$5, updated_at=now() WHERE id=$1`,
      [quizId, quiz.title, quiz.description, quiz.durationMinutes, quiz.showResults || "full"]
    );
    // Like the questions, option order is fixed once someone has started.
    if (!locked) {
      await client.query("UPDATE quizzes SET shuffle_options=$2 WHERE id=$1", [quizId, quiz.shuffleOptions !== false]);
      await client.query("DELETE FROM questions WHERE quiz_id=$1", [quizId]);
      await insertQuestions(client, quizId, quiz.questions);
    }
    return { locked };
  });
}

async function getQuiz(quizId) {
  const { rows } = await query("SELECT * FROM quizzes WHERE id=$1", [quizId]);
  return rows[0] || null;
}

/** Full quiz with questions + options (including correctness). */
async function getQuizWithQuestions(quizId) {
  const quiz = await getQuiz(quizId);
  if (!quiz) return null;
  const { rows: qs } = await query(
    "SELECT * FROM questions WHERE quiz_id=$1 ORDER BY position",
    [quizId]
  );
  const { rows: os } = await query(
    `SELECT o.* FROM options o JOIN questions q ON q.id=o.question_id
     WHERE q.quiz_id=$1 ORDER BY o.position`,
    [quizId]
  );
  const byQ = new Map(qs.map((q) => [q.id, { ...q, options: [] }]));
  for (const o of os) byQ.get(o.question_id)?.options.push(o);
  quiz.questions = qs.map((q) => byQ.get(q.id));
  return quiz;
}

/** Shape used by the builder UI. */
function toBuilderPayload(quiz) {
  return {
    id: quiz.id,
    title: quiz.title,
    description: quiz.description,
    durationMinutes: quiz.duration_minutes,
    shuffleOptions: quiz.shuffle_options,
    showResults: quiz.show_results,
    questions: quiz.questions.map((q) => ({
      type: q.type,
      text: q.text,
      options: q.options.map((o) => ({ text: o.text, correct: o.is_correct })),
    })),
  };
}

/**
 * The questions as a given participant sees them: when the quiz shuffles options,
 * each participant gets their own stable order (Yes/No keeps Yes first).
 */
function questionsForParticipant(quiz, invitation) {
  if (!quiz.shuffle_options) return quiz.questions;
  return quiz.questions.map((q) =>
    q.type === "yesno" ? q : { ...q, options: seededShuffle(q.options, `${invitation.token}:${q.id}`) }
  );
}

async function listQuizzes(adminId) {
  const { rows } = await query(`
    SELECT q.*,
      (SELECT count(*) FROM questions WHERE quiz_id=q.id)::int AS question_count,
      count(i.id)::int AS invited_count,
      count(i.id) FILTER (WHERE i.status='submitted')::int AS submitted_count,
      count(i.id) FILTER (WHERE i.status='in_progress')::int AS in_progress_count,
      round(avg(100.0 * i.score / NULLIF(i.max_score,0)) FILTER (WHERE i.status='submitted'))::int AS avg_percent
    FROM quizzes q
    LEFT JOIN invitations i ON i.quiz_id=q.id
    WHERE q.created_by=$1
    GROUP BY q.id
    ORDER BY q.created_at DESC`, [adminId]);
  return rows;
}

async function duplicateQuiz(quizId, adminId) {
  const quiz = await getQuizWithQuestions(quizId);
  if (!quiz) return null;
  const payload = toBuilderPayload(quiz);
  payload.title = `${quiz.title} (copy)`.slice(0, 200);
  return createQuiz(payload, adminId);
}

module.exports = {
  TYPES,
  SHOW_RESULTS,
  LIMITS,
  TYPE_LABELS,
  validateQuiz,
  createQuiz,
  updateQuiz,
  getQuiz,
  getQuizWithQuestions,
  toBuilderPayload,
  questionsForParticipant,
  listQuizzes,
  duplicateQuiz,
  questionsLocked,
};
