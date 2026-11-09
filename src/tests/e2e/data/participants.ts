import { QUESTIONS } from "./quiz";

export interface Participant {
  id: "amaya" | "daniel" | "priya";
  name: string;
  email: string;
  /**
   * What this person selects, per question (0-based index). A missing entry means
   * they leave the question unanswered.
   */
  answers: Record<number, string[]>;
  /** Hard-coded expectations, cross-checked against the answers below. */
  expected: { score: number; percent: number; rank: number; headline: string };
}

const allCorrect = Object.fromEntries(QUESTIONS.map((q, i) => [i, q.correct]));

export const PARTICIPANTS: Participant[] = [
  {
    id: "amaya",
    name: "Amaya Perera",
    email: "amaya.perera@example.com",
    answers: { ...allCorrect },
    expected: { score: 10, percent: 100, rank: 1, headline: "Outstanding work!" },
  },
  {
    id: "daniel",
    name: "Daniel Silva",
    email: "daniel.silva@example.com",
    answers: {
      ...allCorrect,
      1: ["2"], // multiple answers, one correct option missing → incorrect
      5: ["Yes"], // wrong Yes/No
      7: ["Oxygen"], // wrong single choice
    },
    expected: { score: 7, percent: 70, rank: 2, headline: "Good effort!" },
  },
  {
    id: "priya",
    name: "Priya Raman",
    email: "priya.raman@example.com",
    answers: (() => {
      const a: Record<number, string[]> = {
        ...allCorrect,
        0: ["Berlin"], // wrong single choice
        2: ["No"], // wrong Yes/No
        4: ["Python", "HTML", "JavaScript", "Go"], // all correct + one extra → incorrect
        9: ["Dolphin", "Bat"], // one correct option missing → incorrect
      };
      delete a[6]; // question 7 left unanswered
      return a;
    })(),
    expected: { score: 5, percent: 50, rank: 3, headline: "Good effort!" },
  },
];

export const byId = (id: Participant["id"]) => PARTICIPANTS.find((p) => p.id === id)!;

// ---------- Derived expectations (mirror the app's documented rules) ----------

export type AnswerState = "correct" | "incorrect" | "unanswered";

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** All-or-nothing scoring: the selected set must equal the correct set. */
export function answerState(p: Participant, qIndex: number): AnswerState {
  const picked = p.answers[qIndex];
  if (!picked || picked.length === 0) return "unanswered";
  return sameSet(picked, QUESTIONS[qIndex].correct) ? "correct" : "incorrect";
}

export const questionNumbersWhere = (p: Participant, state: AnswerState) =>
  QUESTIONS.map((_, i) => i).filter((i) => answerState(p, i) === state).map((i) => i + 1);

/** % of submitted participants who answered question i correctly (rounded like the app). */
export const correctPercent = (qIndex: number) =>
  Math.round((100 * PARTICIPANTS.filter((p) => answerState(p, qIndex) === "correct").length) / PARTICIPANTS.length);

/** How many participants picked `option` on question i. */
export const optionPicks = (qIndex: number, option: string) =>
  PARTICIPANTS.filter((p) => (p.answers[qIndex] || []).includes(option)).length;

export const averagePercent = Math.round(PARTICIPANTS.reduce((s, p) => s + p.expected.percent, 0) / PARTICIPANTS.length);
export const topPercent = Math.max(...PARTICIPANTS.map((p) => p.expected.percent));

// Guard against typos in the answer plans: every expectation must follow from them.
for (const p of PARTICIPANTS) {
  for (const [i, picks] of Object.entries(p.answers)) {
    const q = QUESTIONS[Number(i)];
    for (const o of picks) if (!q.options.includes(o)) throw new Error(`Test data: ${p.name} picks "${o}", not an option of Q${Number(i) + 1}.`);
    if (q.type !== "multiple" && picks.length > 1) throw new Error(`Test data: ${p.name} picks several options on single-answer Q${Number(i) + 1}.`);
  }
  const score = questionNumbersWhere(p, "correct").length;
  if (score !== p.expected.score) throw new Error(`Test data: ${p.name} would score ${score}, expected ${p.expected.score}.`);
  if (Math.round((100 * score) / QUESTIONS.length) !== p.expected.percent) throw new Error(`Test data: ${p.name} percent mismatch.`);
}
const ranks = [...PARTICIPANTS].sort((a, b) => b.expected.score - a.expected.score).map((p) => p.expected.rank);
if (ranks.join() !== "1,2,3") throw new Error("Test data: participants need distinct scores ranked 1, 2, 3.");
