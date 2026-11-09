import { restore } from "./cleanup";

/**
 * Runs after every E2E run (passed, failed or interrupted) while the app and its
 * database are still up: removes everything the tests created and verifies the
 * app is back to its baseline. A mismatch fails the run.
 */
export default async function globalTeardown() {
  const { removed, emailsRemoved, mismatches } = await restore();
  const summary = Object.entries(removed).map(([t, n]) => `${n} ${t}`).join(", ");
  console.log(`[e2e-cleanup] removed ${summary}, ${emailsRemoved} emails`);
  if (mismatches.length) {
    throw new Error(`E2E cleanup didn't restore the original state:\n  - ${mismatches.join("\n  - ")}`);
  }
  console.log("[e2e-cleanup] verified: every table and the inbox match the pre-run baseline");
}
