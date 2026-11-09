import { RUN_ID } from "../support/env";
import type { QuizInput } from "../api/AdminApi";

/**
 * Test data for the API tests. Each API scenario makes its own quiz (titled
 * "<scenario> <name> <run id>") and its own participants (emails prefixed with
 * the scenario id), so the tests are independent of each other and of the UI
 * lifecycle tests. Global teardown removes all of it.
 */

/** Shown in scenario steps instead of the run-specific suffix, so step names stay stable. */
export const RUN_PLACEHOLDER = "[date and time]";

export const apiTitle = (base: string) => `${base} ${RUN_ID}`;
export const docTitle = (base: string) => `${base} ${RUN_PLACEHOLDER}`;

/** The app's CSV filename rule: title → lowercase, non-alphanumerics → "-". */
export const csvFilename = (title: string) =>
  `${title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}-results.csv`;

/** A small quiz with one question of each type. */
export const Q = {
  single: { text: "What is 2 + 2?", options: ["3", "4", "5"], correct: ["4"] },
  yesno: { text: "Is the sky blue on a clear day?", options: ["Yes", "No"], correct: ["Yes"] },
  multiple: { text: "Which of these are prime numbers?", options: ["2", "3", "4"], correct: ["2", "3"] },
} as const;

export const QUESTION_ORDER = [Q.single, Q.yesno, Q.multiple];
export const OPTION_COUNT = QUESTION_ORDER.reduce((n, q) => n + q.options.length, 0); // 8
export const CORRECT_COUNT = QUESTION_ORDER.reduce((n, q) => n + q.correct.length, 0); // 4

export function apiQuiz(title: string, extra: Partial<QuizInput> = {}): QuizInput {
  return {
    title,
    description: "Created by the Playwright API tests.",
    durationMinutes: 5,
    shuffleOptions: true,
    showResults: "full",
    questions: [
      { type: "single", text: Q.single.text, options: Q.single.options.map((t) => ({ text: t, correct: (Q.single.correct as readonly string[]).includes(t) })) },
      { type: "yesno", text: Q.yesno.text, options: Q.yesno.options.map((t) => ({ text: t, correct: (Q.yesno.correct as readonly string[]).includes(t) })) },
      { type: "multiple", text: Q.multiple.text, options: Q.multiple.options.map((t) => ({ text: t, correct: (Q.multiple.correct as readonly string[]).includes(t) })) },
    ],
    ...extra,
  };
}

export const API_PASSWORDS = {
  intruder: "Intruder-Pass-2026",
  victim: "Victim-Pass-2026",
  other: "Other-Pass-2026",
  max: "Max-Pass-2026",
  sneaky: "Sneaky-Pass-2026",
};

export const PARTICIPANT_PASSWORD_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789]{10}$/;
export const ADMIN_RESET_PASSWORD_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789]{12}$/;
export const CSV_HEADER = ["Rank", "Name", "Email", "Score", "Out of", "Percent", "Time taken", "Submitted at", "Auto-submitted"];
