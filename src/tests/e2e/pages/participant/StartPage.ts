import { Locator, Page } from "@playwright/test";
import { BasePage } from "../BasePage";
import { ConfirmDialog } from "../components/ConfirmDialog";

/** /q/:token/start — instructions before the timer starts. */
export class StartPage extends BasePage {
  readonly greeting: Locator;
  readonly quizTitle: Locator;
  readonly ruleTitles: Locator;
  readonly startButton: Locator;
  readonly confirm: ConfirmDialog;

  constructor(page: Page) {
    super(page);
    this.greeting = page.locator(".quiz-hero .eyebrow");
    this.quizTitle = page.locator(".quiz-hero h1");
    this.ruleTitles = page.locator(".rules li strong");
    this.startButton = page.getByRole("button", { name: "Start quiz" });
    this.confirm = new ConfirmDialog(page);
  }

  /** Explanation under a rule, e.g. ruleText("After you submit"). */
  ruleText(title: string): Locator {
    return this.page.locator(".rules li").filter({ has: this.page.locator("strong", { hasText: title }) }).locator("strong + span");
  }

  async ruleTitleTexts() {
    return this.texts(this.ruleTitles);
  }

  /** Visit /start directly (used to prove a finished attempt can't restart). */
  async gotoDirect(link: string) {
    await this.page.goto(`${link}/start`);
  }
}
