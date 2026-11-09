import { RUN_ID } from "../support/env";

export type QuestionType = "single" | "multiple" | "yesno";

export interface QuizQuestion {
  type: QuestionType;
  text: string;
  /** Options in the order the admin types them. Yes/No is always ["Yes", "No"]. */
  options: string[];
  correct: string[];
}

/** Labels exactly as the app shows them. */
export const TYPE_LABEL: Record<QuestionType, string> = {
  single: "Single choice",
  multiple: "Multiple answers",
  yesno: "Yes / No",
};

/** Hint the quiz player shows under each question type. */
export const TYPE_HINT: Record<QuestionType, string> = {
  single: "Select one answer.",
  multiple: "Select all answers that apply.",
  yesno: "Select Yes or No.",
};

/** 10 questions: 3 single choice (MCQ), 4 multiple answers, 3 Yes / No, mixed order. */
export const QUESTIONS: QuizQuestion[] = [
  { type: "single", text: "What is the capital of France?", options: ["Berlin", "Madrid", "Paris", "Rome"], correct: ["Paris"] },
  { type: "multiple", text: "Which of these are prime numbers?", options: ["2", "3", "4", "9"], correct: ["2", "3"] },
  { type: "yesno", text: "Is the Pacific the largest ocean on Earth?", options: ["Yes", "No"], correct: ["Yes"] },
  { type: "single", text: "How many days are in a leap year?", options: ["365", "366", "367"], correct: ["366"] },
  { type: "multiple", text: "Which of these are programming languages?", options: ["Python", "HTML", "JavaScript", "CSS", "Go"], correct: ["Python", "JavaScript", "Go"] },
  { type: "yesno", text: "Does water boil at 50 °C at sea level?", options: ["Yes", "No"], correct: ["No"] },
  { type: "multiple", text: "Which planets are gas giants?", options: ["Jupiter", "Mars", "Saturn", "Venus"], correct: ["Jupiter", "Saturn"] },
  { type: "single", text: "Which gas do plants absorb from the air?", options: ["Oxygen", "Carbon dioxide", "Nitrogen", "Helium"], correct: ["Carbon dioxide"] },
  { type: "yesno", text: "Is HTTPS more secure than HTTP?", options: ["Yes", "No"], correct: ["Yes"] },
  { type: "multiple", text: "Which of these animals are mammals?", options: ["Dolphin", "Shark", "Bat", "Penguin", "Whale"], correct: ["Dolphin", "Bat", "Whale"] },
];

export const QUIZ = {
  baseTitle: "E2E General Knowledge",
  description: "End-to-end test quiz covering single choice, multiple answers and Yes / No questions.",
  durationMinutes: 15,
};

/** Unique title for this run, e.g. "E2E General Knowledge 2026-11-09 14:05:33". */
export const QUIZ_TITLE = `${QUIZ.baseTitle} ${RUN_ID}`;

/** File name the app gives the CSV export (routes/admin.js). */
export const CSV_FILENAME = `${QUIZ_TITLE.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}-results.csv`;

// The suite promises 3 Yes/No, 3 single choice and 4 multiple-answer questions.
const count = (t: QuestionType) => QUESTIONS.filter((q) => q.type === t).length;
if (QUESTIONS.length !== 10 || count("yesno") !== 3 || count("single") !== 3 || count("multiple") !== 4) {
  throw new Error("Test data: the quiz must have 10 questions (3 Yes/No, 3 single choice, 4 multiple answers).");
}
