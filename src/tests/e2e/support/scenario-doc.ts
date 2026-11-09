/**
 * Generates src/tests/e2e-test-scenarios.md from scenarios.ts plus the latest
 * execution results (src/tests/e2e/scenarios/last-results.json).
 */
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { SCENARIOS, UI_SCENARIOS, API_SCENARIOS } from "../scenarios/scenarios";
import type { Scenario } from "../scenarios/define";
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

/** The last execution as a whole (one `npm run test:…`). */
export interface RunRecord {
  date: string;
  commit: string;
  /** Playwright's overall result, which includes global setup/teardown (cleanup checks). */
  status: "passed" | "failed" | "timedout" | "interrupted";
  /** Projects that ran: "api", "chromium". */
  projects: string[];
  /** Errors outside any test, e.g. a failed cleanup check (first line of each). */
  errors: string[];
}

export interface ResultsFile {
  run?: RunRecord;
  cases: Record<string, ExecRecord>;
}

export function readResults(): ResultsFile {
  try {
    const raw = JSON.parse(fs.readFileSync(RESULTS_PATH, "utf8"));
    // Older files were a flat { "<id>": ExecRecord } map.
    return raw && typeof raw.cases === "object" ? raw : { cases: raw || {} };
  } catch {
    return { cases: {} };
  }
}

/**
 * Overall verdict for the document: PASSED only when every documented test case
 * passed and the run itself (including cleanup checks) passed. Anything else,
 * including cases that didn't run, is FAILED, with the reasons.
 */
export function overallStatus(file: ResultsFile): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const by = (st: ExecStatus) => SCENARIOS.filter((sc) => (file.cases[sc.id]?.status || "Not run") === st).map((sc) => sc.id);
  const failed = by("Failed");
  const skipped = by("Skipped");
  const notRun = by("Not run");
  if (failed.length) reasons.push(`${failed.length} failed: ${failed.join(", ")}`);
  if (skipped.length) reasons.push(`${skipped.length} skipped (an earlier case in the same flow failed): ${skipped.join(", ")}`);
  if (notRun.length) reasons.push(`${notRun.length} never run: ${notRun.join(", ")}`);
  if (!file.run) reasons.push("no recorded run");
  else {
    if (file.run.status !== "passed" && !failed.length) reasons.push(`the run ended as "${file.run.status}"`);
    for (const e of file.run.errors) reasons.push(`outside the test cases: ${e}`);
    const stale = SCENARIOS.filter((sc) => file.cases[sc.id] && file.cases[sc.id].date !== file.run!.date).map((sc) => sc.id);
    if (stale.length) reasons.push(`${stale.length} result(s) are from an earlier run (this run only covered ${file.run.projects.join(" + ") || "nothing"}): ${stale.join(", ")}`);
  }
  return { passed: reasons.length === 0, reasons };
}

/** Short commit id; marks a dirty working tree so results aren't attributed to a commit that didn't contain the code. */
export function currentCommit(): string {
  // CI sets E2E_COMMIT to the commit under test (a PR's head commit, not GitHub's
  // temporary merge commit), and the checkout there is always clean.
  if (process.env.E2E_COMMIT) return process.env.E2E_COMMIT.slice(0, 7);
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

export function renderDoc(file: ResultsFile = readResults()): string {
  const results = file.cases;
  const verdict = overallStatus(file);
  const row = (s: Scenario) => {
    const r = results[s.id] || { status: "Not run" as ExecStatus, date: "—", commit: "—" };
    const steps = s.steps
      .map((st, i) => `**${i + 1}.** ${cell(st.action)}<br>&nbsp;&nbsp;&nbsp;&nbsp;➜ *Expected:* ${cell(st.expected)}`)
      .join("<br><br>");
    const icon = { Passed: "✅", Failed: "❌", Skipped: "⏭️", "Not run": "⚪" }[r.status];
    return `| ${s.id} | ${cell(s.title)}<br><br>*Preconditions:* ${cell(s.preconditions)} | ${steps} | ${s.priority} | ${cell(s.component)} | ${icon} ${r.status} | ${r.date} | \`${r.commit}\` |`;
  };
  const TABLE_HEAD = "| ID | Test Case Title | Steps | Priority | Component | Execution Status | Execution Date | Tested Commit |\n|---|---|---|---|---|---|---|---|";
  const table = (list: Scenario[]) => `${TABLE_HEAD}\n${list.map(row).join("\n")}`;
  const summary = (list: Scenario[]) => {
    const c = list.reduce<Record<string, number>>((acc, sc) => {
      const st = results[sc.id]?.status || "Not run";
      acc[st] = (acc[st] || 0) + 1;
      return acc;
    }, {});
    return ["Passed", "Failed", "Skipped", "Not run"].filter((k) => c[k]).map((k) => `${c[k]} ${k.toLowerCase()}`).join(" · ");
  };


  const questionTable = QUESTIONS.map(
    (q, i) => `| ${i + 1} | ${TYPE_LABEL[q.type]} | ${cell(q.text)} | ${q.options.map((o) => cell(o)).join(", ")} | ${q.correct.map((o) => `**${cell(o)}**`).join(", ")} |`
  ).join("\n");
  const participantTable = PARTICIPANTS.map((p) => {
    const answers = QUESTIONS.map((_, i) => `Q${i + 1}: ${(p.answers[i] || []).join(" + ") || "*(unanswered)*"}`).join("<br>");
    return `| ${p.name} | ${p.email} | ${answers} | ${p.expected.score}/${QUESTIONS.length} (${p.expected.percent}%) | ${p.expected.rank} | ${nums(questionNumbersWhere(p, "incorrect"))} | ${nums(questionNumbersWhere(p, "unanswered"))} |`;
  }).join("\n");

  return `<!-- GENERATED FILE. Edit src/tests/e2e/scenarios/scenarios.ts (steps) or run the suite (status); then: npm run test:e2e:doc -->
# Quiz Portal: E2E test scenarios

| Overall status | Executed | Tested commit | Test cases |
|---|---|---|---|
| ${verdict.passed ? "✅ **PASSED**" : "❌ **FAILED**"} | ${file.run?.date ?? "—"} | \`${file.run?.commit ?? "—"}\` | ${summary(SCENARIOS)} (browser: ${summary(UI_SCENARIOS)}; API: ${summary(API_SCENARIOS)}) |
${verdict.passed ? "" : `\n**Why it failed:**\n\n${verdict.reasons.map((r) => `- ${cell(r)}`).join("\n")}\n`}
The overall status is **PASSED** only when every test case below passed in the same run and the run's clean-up checks passed. If even one case failed, was skipped or didn't run, it's **FAILED**.

These are the automated test cases for Quiz Portal, in two groups:

- **Browser end-to-end tests (E2E-…)**: Playwright drives Chromium through the whole life of a quiz, like real people would ([\`e2e/specs/ui\`](e2e/specs/ui)). In the Allure report each step has a full-page screenshot.
- **API tests (API-…)**: plain HTTP requests, no browser, for the rules a browser test can't reach easily: sign-in, CSRF, validation, privacy between admins, team roles, one browser per link, scoring edge cases, CSV safety and error pages ([\`e2e/specs/api\`](e2e/specs/api)). In the Allure report each step has every HTTP request and response it made.

Each step below is also a named step in the Allure report, and a person can run every case by hand by following the steps exactly.

## How to run

| What | Command |
|---|---|
| Run everything (starts its own throwaway database, mailbox and app; needs Docker) | \`npm run test:e2e\` |
| Only the API tests (about 25 seconds) | \`npm run test:api\` |
| Watch it run in a visible browser | \`npm run test:e2e:headed\` |
| Build and open the Allure report | \`npm run test:e2e:report\` |
| Regenerate this file without running tests | \`npm run test:e2e:doc\` |

The browser cases run **in order** (E2E-01 → E2E-11), because each one builds on the previous one. If one fails, the later ones are marked **Skipped**. Each API case is independent: it creates its own quiz and participants (quiz titles start with the case ID, emails with \`apiNN.\`).

**Clean-up:** whatever happens (pass, fail or Ctrl+C), the run ends by deleting every quiz, invitation, answer, admin, session and email it created, and restoring the admin account. It then checks that every database table and the inbox match what they were before the run, and that the app logged no errors. If either check fails, the run fails. See the \`[e2e-cleanup]\` lines at the end of the output.

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

## Test cases: browser end-to-end

${table(UI_SCENARIOS)}

## Test cases: API

${table(API_SCENARIOS)}
`;
}

function nums(list: number[]) {
  return list.length ? list.map((n) => `Q${n}`).join(", ") : "—";
}

export function writeDoc(file?: ResultsFile) {
  fs.writeFileSync(DOC_PATH, renderDoc(file));
}
