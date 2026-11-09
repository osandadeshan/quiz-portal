/** npm run test:e2e:doc — regenerate e2e-test-scenarios.md from scenarios.ts and the last results. */
import { writeDoc, DOC_PATH } from "../support/scenario-doc";

writeDoc();
console.log(`Wrote ${DOC_PATH}`);
