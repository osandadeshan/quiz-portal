import AllureReporter from "allure-playwright";
import type { Suite } from "@playwright/test/reporter";

/**
 * allure-playwright, minus one quirk: it turns every test annotation it doesn't
 * know into a step, so serial mode's "serial" annotation showed up as a
 * meaningless first step ("serial: undefined") in every test.
 */
export default class QuizPortalAllureReporter extends AllureReporter {
  // allure-playwright uses Playwright's v2 reporter API: onBegin(suite).
  onBegin(suite: Suite) {
    for (const test of suite.allTests()) {
      for (let i = test.annotations.length - 1; i >= 0; i--) {
        if (test.annotations[i].type === "serial") test.annotations.splice(i, 1);
      }
    }
    return super.onBegin(suite);
  }
}
