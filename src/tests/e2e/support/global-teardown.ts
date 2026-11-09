import fs from "fs";
import path from "path";
import { restore } from "./cleanup";
import { OUTPUT_DIR } from "./env";

const APP_LOG = path.join(OUTPUT_DIR, "app.log");
/** Lines that mean the app hit an unexpected error (500 handler, crashes, DB pool errors). */
const ERROR_LINE = /^(Error|TypeError|ReferenceError|RangeError|SyntaxError)\b|Unhandled|\[db\] idle client error|\[mail\] send failed/;

/**
 * Runs after every E2E run (passed, failed or interrupted) while the app and its
 * database are still up: removes everything the tests created and verifies the
 * app is back to its baseline. A mismatch fails the run.
 */
export default async function globalTeardown() {
  const { removed, restored, emailsRemoved, mismatches } = await restore();
  for (const r of restored) console.log(`[e2e-cleanup] restored ${r}`);
  // The app must not have logged an unexpected error during the run (this was the
  // old curl smoke test's last check). Checked after cleanup so cleanup always runs.
  if (fs.existsSync(APP_LOG)) {
    const errors = fs.readFileSync(APP_LOG, "utf8").split("\n").filter((l) => ERROR_LINE.test(l));
    if (errors.length) mismatches.push(`the app logged ${errors.length} error line(s) during the run (see src/tests/.output/app.log):\n      ${errors.slice(0, 5).join("\n      ")}`);
    else console.log("[e2e-cleanup] app log: no errors");
  }
  const summary = Object.entries(removed).map(([t, n]) => `${n} ${t}`).join(", ");
  console.log(`[e2e-cleanup] removed ${summary}, ${emailsRemoved} emails`);
  if (mismatches.length) {
    throw new Error(`E2E teardown checks failed:\n  - ${mismatches.join("\n  - ")}`);
  }
  console.log("[e2e-cleanup] verified: every table and the inbox match the pre-run baseline");
}
