import fs from "fs";
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestError, TestResult } from "@playwright/test/reporter";
import { SCENARIOS } from "../scenarios/scenarios";
import { ExecRecord, ExecStatus, RESULTS_PATH, ResultsFile, currentCommit, readResults, writeDoc } from "./scenario-doc";

/**
 * After every run, records each scenario's status, the date and the commit, and
 * regenerates src/tests/e2e-test-scenarios.md. Scenarios not part of this run
 * keep their previous result.
 */
export default class ScenarioReporter implements Reporter {
  private readonly last = new Map<string, TestResult["status"]>();
  private readonly planned = new Set<string>();
  private readonly projects = new Set<string>();
  private readonly errors: string[] = [];

  onBegin(_config: FullConfig, suite: Suite) {
    for (const t of suite.allTests()) {
      const scenario = SCENARIOS.find((s) => s.testTitle === t.title);
      if (scenario) this.planned.add(scenario.id);
      const project = t.parent.project()?.name;
      if (project) this.projects.add(project);
    }
  }

  /** Errors outside tests: global setup/teardown (the clean-up checks), webServer, config. */
  onError(error: TestError) {
    const first = (error.message || error.value || "unknown error").replace(/\u001b\[[0-9;]*m/g, "").split("\n").find((l) => l.trim()) || "unknown error";
    this.errors.push(first.replace(/^Error:\s*/, "").trim());
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const scenario = SCENARIOS.find((s) => s.testTitle === test.title);
    if (scenario) this.last.set(scenario.id, result.status); // last attempt wins
  }

  onEnd(result: FullResult) {
    // Tests that never started (e.g. after an earlier failure in the serial flow) count as skipped.
    for (const id of this.planned) if (!this.last.has(id)) this.last.set(id, "skipped");
    if (!this.last.size && !this.errors.length) return;
    const file: ResultsFile = readResults();
    const date = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
    const commit = currentCommit();
    for (const [id, status] of this.last) {
      const mapped: ExecStatus = status === "passed" ? "Passed" : status === "skipped" ? "Skipped" : "Failed";
      file.cases[id] = { status: mapped, date, commit } satisfies ExecRecord;
    }
    // onEnd runs after global teardown, so result.status includes the clean-up checks.
    file.run = { date, commit, status: result.status, projects: [...this.projects].sort(), errors: this.errors };
    fs.writeFileSync(RESULTS_PATH, JSON.stringify(file, null, 2) + "\n");
    writeDoc(file);
    console.log(`\nScenario document updated: src/tests/e2e-test-scenarios.md`);
  }

  printsToStdio() {
    return false;
  }
}
