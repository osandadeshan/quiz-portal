/**
 * Generates src/tests/e2e-test-scenarios.md from scenarios.ts plus the latest
 * execution results (src/tests/e2e/scenarios/last-results.json).
 */
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { SCENARIOS } from "../scenarios/scenarios";
import { APP_URL, MAILBOX_URL, ADMIN, TESTS_DIR, REPO_ROOT } from "./env";
import { QUESTIONS, QUIZ, TYPE_LABEL } from "../data/quiz";
import { PARTICIPANTS, questionNumbersWhere } from "../data/participants";

export type ExecStatus = "Passed" | "Failed" | "Skipped" | "Not run";
export interface ExecRecord {
  status: ExecStatus;
  date: string;
  commit: string;
}

export const DOC_PATH = path.join(TESTS_DIR, "e2e-test-scenarios.md");
export const RESULTS_PATH = path.join(TESTS_DIR, "e2e", "scenarios", "last-results.json");

export function readResults(): Record<string, ExecRecord> {
  try {
    return JSON.parse(fs.readFileSync(RESULTS_PATH, "utf8"));
  } catch {
    return {};
  }
}

/** Short commit id; marks a dirty working tree so results aren't attributed to a commit that didn't contain the code. */
export function currentCommit(): string {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT }).toString().trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: REPO_ROOT }).toString().trim() !== "";
    return dirty ? `${sha} (+ uncommitted changes)` : sha;
  } catch {
    return "unknown";
  }
}

/** Escape text for a Markdown table cell: pipes, newlines, and < > outside `code` spans. */
const cell = (s: string) =>
  s
    .split(/(`[^`]*`)/)
    .map((part) => (part.startsWith("`") ? part : part.replace(/</g, "&lt;").replace(/>/g, "&gt;")))
    .join("")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");

export function renderDoc(results: Record<string, ExecRecord> = readResults()): string {
  const rows = SCENARIOS.map((s) => {
    const r = results[s.id] || { status: "Not run" as ExecStatus, date: "—", commit: "—" };
    const steps = s.steps
      .map((st, i) => `**${i + 1}.** ${cell(st.action)}<br>&nbsp;&nbsp;&nbsp;&nbsp;➜ *Expected:* ${cell(st.expected)}`)
      .join("<br><br>");
    const icon = { Passed: "✅", Failed: "❌", Skipped: "⏭️", "Not run": "⚪" }[r.status];
    return `| ${s.id} | ${cell(s.title)}<br><br>*Preconditions:* ${cell(s.preconditions)} | ${steps} | ${s.priority} | ${cell(s.component)} | ${icon} ${r.status} | ${r.date} | \`${r.commit}\` |`;
  });

  const counts = SCENARIOS.reduce<Record<string, number>>((acc, s) => {
    const st = results[s.id]?.status || "Not run";
    acc[st] = (acc[st] || 0) + 1;
    return acc;
  }, {});

  const questionTable = QUESTIONS.map(
    (q, i) => `| ${i + 1} | ${TYPE_LABEL[q.type]} | ${cell(q.text)} | ${q.options.map((o) => cell(o)).join(", ")} | ${q.correct.map((o) => `**${cell(o)}**`).join(", ")} |`
  ).join("\n");
  const participantTable = PARTICIPANTS.map((p) => {
    const answers = QUESTIONS.map((_, i) => `Q${i + 1}: ${(p.answers[i] || []).join(" + ") || "*(unanswered)*"}`).join("<br>");
    return `| ${p.name} | ${p.email} | ${answers} | ${p.expected.score}/${QUESTIONS.length} (${p.expected.percent}%) | ${p.expected.rank} | ${nums(questionNumbersWhere(p, "incorrect"))} | ${nums(questionNumbersWhere(p, "unanswered"))} |`;
  }).join("\n");

  return `<!-- GENERATED FILE. Edit src/tests/e2e/scenarios/scenarios.ts (steps) or run the suite (status); then: npm run test:e2e:doc -->
# Quiz Portal: E2E test scenarios

These are the end-to-end test cases for Quiz Portal. Each one is automated with Playwright in [\`src/tests/e2e/specs\`](e2e/specs), and each step below is also a named step (with a screenshot) in the Allure report. A person can also run them by hand by following the steps exactly.

**Summary of the last run:** ${["Passed", "Failed", "Skipped", "Not run"].filter((k) => counts[k]).map((k) => `${counts[k]} ${k.toLowerCase()}`).join(" · ")}

## How to run

| What | Command |
|---|---|
| Run the whole suite (starts its own throwaway database, mailbox and app; needs Docker) | \`npm run test:e2e\` |
| Watch it run in a visible browser | \`npm run test:e2e:headed\` |
| Build and open the Allure report | \`npm run test:e2e:report\` |
| Regenerate this file without running tests | \`npm run test:e2e:doc\` |

The suite runs the cases **in order** (E2E-01 → E2E-11), because each one builds on the previous one. If a case fails, the later ones are marked **Skipped**.

**Clean-up:** whatever happens (pass, fail or Ctrl+C), the run ends by deleting every quiz, invitation, answer, session and email it created, and restoring the admin account. It then checks that every database table and the inbox match what they were before the run. If they don't, the run fails. See the \`[e2e-cleanup]\` lines at the end of the output.

## Environment used by the automated run

| Item | Value |
|---|---|
| Quiz Portal | ${APP_URL} (fresh, empty database on every run) |
| Test mailbox (Mailpit, catches every email the app sends) | ${MAILBOX_URL} |
| Admin account | ${ADMIN.email} / \`${ADMIN.password}\` |
| Quiz title | ${QUIZ.baseTitle} + date and time of the run |
| Time limit | ${QUIZ.durationMinutes} minutes |

When running by hand against another installation, use your own addresses and admin account, and any mailbox the participants' emails reach.

## Test data

### Questions (entered in E2E-02)

| # | Type | Question | Options (in the order typed) | Correct |
|---|---|---|---|---|
${questionTable}

### Participants and their answers (E2E-04 to E2E-06)

| Name | Email | Answers to select | Expected score | Expected rank | Incorrect | Unanswered |
|---|---|---|---|---|---|---|
${participantTable}

## Test cases

| ID | Test Case Title | Steps | Priority | Component | Execution Status | Execution Date | Tested Commit |
|---|---|---|---|---|---|---|---|
${rows.join("\n")}
`;
}

function nums(list: number[]) {
  return list.length ? list.map((n) => `Q${n}`).join(", ") : "—";
}

export function writeDoc(results?: Record<string, ExecRecord>) {
  fs.writeFileSync(DOC_PATH, renderDoc(results));
}
