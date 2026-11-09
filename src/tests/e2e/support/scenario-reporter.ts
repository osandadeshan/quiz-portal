import fs from "fs";
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from "@playwright/test/reporter";
import { SCENARIOS } from "../scenarios/scenarios";
import { ExecRecord, ExecStatus, RESULTS_PATH, currentCommit, readResults, writeDoc } from "./scenario-doc";

/**
 * After every run, records each scenario's status, the date and the commit, and
 * regenerates src/tests/e2e-test-scenarios.md. Scenarios not part of this run
 * keep their previous result.
 */
export default class ScenarioReporter implements Reporter {
  private readonly last = new Map<string, TestResult["status"]>();
  private readonly planned = new Set<string>();

  onBegin(_config: FullConfig, suite: Suite) {
    for (const t of suite.allTests()) {
      const scenario = SCENARIOS.find((s) => s.testTitle === t.title);
      if (scenario) this.planned.add(scenario.id);
    }
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const scenario = SCENARIOS.find((s) => s.testTitle === test.title);
    if (scenario) this.last.set(scenario.id, result.status); // last attempt wins
  }

  onEnd(_result: FullResult) {
    // Tests that never started (e.g. after an earlier failure in the serial flow) count as skipped.
    for (const id of this.planned) if (!this.last.has(id)) this.last.set(id, "skipped");
    if (!this.last.size) return;
    const results = readResults();
    const date = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
    const commit = currentCommit();
    for (const [id, status] of this.last) {
      const mapped: ExecStatus = status === "passed" ? "Passed" : status === "skipped" ? "Skipped" : "Failed";
      results[id] = { status: mapped, date, commit } satisfies ExecRecord;
    }
    fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2) + "\n");
    writeDoc(results);
    console.log(`\nScenario document updated: src/tests/e2e-test-scenarios.md`);
  }

  printsToStdio() {
    return false;
  }
}
