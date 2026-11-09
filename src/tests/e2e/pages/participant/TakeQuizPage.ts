import { Locator, Page } from "@playwright/test";
import { BasePage } from "../BasePage";

export interface ChoiceState {
  text: string;
  inputType: string;
  checked: boolean;
}

/** /q/:token/take — the quiz player. */
export class TakeQuizPage extends BasePage {
  readonly counter: Locator;
  readonly questionText: Locator;
  readonly hint: Locator;
  readonly choices: Locator;
  readonly nextButton: Locator;
  readonly answeredLabel: Locator;
  readonly timer: Locator;
  readonly saveState: Locator;
  readonly navButtons: Locator;
  readonly quizData: Locator;
  readonly submitDialog: Locator;
  readonly submitDialogTitle: Locator;
  readonly submitSummary: Locator;
  readonly unansweredButtons: Locator;
  readonly submitNowButton: Locator;

  constructor(page: Page) {
    super(page);
    this.counter = page.locator("#q-counter");
    this.questionText = page.locator("#q-text");
    this.hint = page.locator("#q-hint");
    this.choices = page.locator("#choices .choice");
    this.nextButton = page.locator("#next-btn");
    this.answeredLabel = page.locator("#answered-label");
    this.timer = page.locator("#timer-text");
    this.saveState = page.locator("#save-state .txt");
    this.navButtons = page.locator("#nav-grid .nav-btn");
    this.quizData = page.locator("script#quiz-data");
    this.submitDialog = page.locator("dialog#submit-modal");
    this.submitDialogTitle = this.submitDialog.locator("h3");
    this.submitSummary = page.locator("#submit-summary");
    this.unansweredButtons = page.locator("#submit-unanswered button");
    this.submitNowButton = page.getByRole("button", { name: "Submit now" });
  }

  choice(text: string): Locator {
    return this.choices.filter({ has: this.page.locator(":scope > span:nth-of-type(2)", { hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }) });
  }

  navButton(questionNumber: number): Locator {
    return this.navButtons.nth(questionNumber - 1);
  }

  async select(options: string[]) {
    for (const o of options) await this.choice(o).click();
  }

  async next() {
    await this.nextButton.click();
  }

  /** Options in the order shown, with their input type and checked state. */
  async readChoices(): Promise<ChoiceState[]> {
    return this.choices.evaluateAll((labels) =>
      labels.map((l) => {
        const input = l.querySelector("input") as HTMLInputElement;
        return { text: (l.querySelector(":scope > span:nth-of-type(2)")?.textContent || "").trim(), inputType: input.type, checked: input.checked };
      })
    );
  }

  /** Remaining time shown by the countdown, in seconds. */
  async timerSeconds(): Promise<number> {
    const t = (await this.timer.innerText()).trim();
    const parts = t.split(":").map(Number);
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }

  /** The JSON the server embedded for the quiz player (what the browser receives). */
  async embeddedQuizData(): Promise<string> {
    return (await this.quizData.textContent()) || "";
  }

  async openSubmitDialog() {
    await this.nextButton.click();
  }

  async submitNow() {
    await this.submitNowButton.click();
  }
}
