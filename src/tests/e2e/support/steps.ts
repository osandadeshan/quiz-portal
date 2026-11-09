import { test, expect, Page, TestInfo } from "@playwright/test";
import { Scenario } from "../scenarios/define";

/**
 * Runs a documented scenario step:
 *
 *   test.step(<action>)            ← name shown in Allure: the Markdown step's text, without ** / ` marks
 *     ├─ act()                     ← what the user does
 *     ├─ test.step("Verify: …")    ← assertions for the documented expected result
 *     └─ full-page screenshot      ← attached at the end of the step (also on failure)
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
    await test.step(plainText(def.action), async () => {
      try {
        await act();
        await test.step(`Verify: ${plainText(def.expected)}`, async () => {
          await verify();
        });
      } finally {
        await this.capture(`Step ${n} screenshot`);
      }
    });
  }

  private async capture(name: string) {
    const page = this.page;
    if (!page || page.isClosed()) return;
    try {
      const body = await page.screenshot({ fullPage: true, animations: "disabled", timeout: 15_000 });
      await this.testInfo.attach(name, { body, contentType: "image/png" });
    } catch {
      // A screenshot must never hide the real failure.
    }
  }

  /** Called by the fixture after a passing test. */
  assertAllStepsRan() {
    expect(this.executed, `${this.scenario.id}: every documented step must run, in the documented order`).toEqual(
      this.scenario.steps.map((s) => s.key)
    );
  }
}
