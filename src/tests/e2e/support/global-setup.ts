import { snapshot } from "./cleanup";

/** Records the app's state before any test runs, so global teardown can restore it. */
export default async function globalSetup() {
  const snap = await snapshot();
  const rows = Object.entries(snap.fingerprints).map(([t, f]) => `${t}=${f.rows}`).join(", ");
  console.log(`[e2e-cleanup] baseline recorded: ${rows}; inbox=${snap.mailIds.length} emails`);
}
