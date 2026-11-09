import { test, expect, Page, TestInfo } from "@playwright/test";
import { Scenario } from "../scenarios/define";
import { httpLog, formatExchanges } from "../api/HttpSession";

/**
 * Runs a documented scenario step:
 *
 *   test.step(<action>)            ← name shown in Allure: the Markdown step's text, without ** / ` marks
 *     ├─ act()                     ← what the user does
 *     ├─ test.step("Verify: …")    ← assertions for the documented expected result
 *     └─ evidence                  ← attached at the end of the step (also on failure):
 *                                      UI tests: a full-page screenshot of the page set with use(page)
 *                                      API tests: every HTTP request/response made during the step
 *
 * Every step must have assertions (`verify` is required), and when the test
 * passes the fixture checks that every documented step ran, in order.
 */
/** Step text without Markdown marks, so Allure shows "Click Sign in", not "Click **Sign in**". */
export const plainText = (markdown: string) => markdown.replace(/\*\*|`/g, "").replace(/(^|\s)\*([^*]+)\*/g, "$1$2");

export class ScenarioSteps {
  private readonly executed: string[] = [];
  private page: Page | undefined;

  constructor(
    readonly scenario: Scenario,
    private readonly testInfo: TestInfo
  ) {}

  /** The page whose screenshot is attached after each step. */
  use(page: Page): this {
    this.page = page;
    return this;
  }

  async step(key: string, act: () => Promise<unknown>, verify: () => Promise<unknown>): Promise<void> {
    const def = this.scenario.step(key);
    const n = this.scenario.steps.indexOf(def) + 1;
    this.executed.push(key);
    const firstExchange = httpLog.length;
    await test.step(plainText(def.action), async () => {
      let passed = false;
      try {
        await act();
        await test.step(`Verify: ${plainText(def.expected)}`, async () => {
          await verify();
        });
        passed = true;
      } finally {
        const exchanges = httpLog.slice(firstExchange);
        if (exchanges.length) {
          await this.testInfo.attach(`Step ${n} HTTP requests`, { body: formatExchanges(exchanges), contentType: "text/plain" });
        }
        const shot = await this.capture(`Step ${n} screenshot`);
        // Every step must leave evidence in the report. (Not checked on failure, so
        // the real error isn't hidden.)
        if (passed && !shot && !exchanges.length) {
          throw new Error(`${this.scenario.id} step "${key}" left no evidence: call steps.use(page) for UI steps, or make an HTTP request in API steps.`);
        }
      }
    });
  }

  private async capture(name: string): Promise<boolean> {
    const page = this.page;
    if (!page || page.isClosed()) return false;
    try {
      const body = await page.screenshot({ fullPage: true, animations: "disabled", timeout: 15_000 });
      await this.testInfo.attach(name, { body, contentType: "image/png" });
      return true;
    } catch {
      // A screenshot must never hide the real failure.
      return false;
    }
  }

  /** Called by the fixture after a passing test. */
  assertAllStepsRan() {
    expect(this.executed, `${this.scenario.id}: every documented step must run, in the documented order`).toEqual(
      this.scenario.steps.map((s) => s.key)
    );
  }
}
