import { Locator, Page } from "@playwright/test";
import { BasePage } from "../BasePage";

/** /q/:token — the participant's sign-in page. */
export class ParticipantLoginPage extends BasePage {
  readonly quizTitle: Locator;
  readonly chips: Locator;
  readonly signingInAs: Locator;
  readonly passwordInput: Locator;
  readonly continueButton: Locator;
  readonly error: Locator;
  readonly completedNotice: Locator;

  constructor(page: Page) {
    super(page);
    this.quizTitle = page.locator(".quiz-hero h1");
    this.chips = page.locator(".quiz-hero .chip");
    this.signingInAs = page.locator(".field").filter({ hasText: "Signing in as" }).locator(".readonly-box");
    this.passwordInput = page.getByLabel("Password", { exact: true });
    this.continueButton = page.getByRole("button", { name: "Continue" });
    this.error = page.locator(".alert-error .alert-body");
    this.completedNotice = page.locator(".alert-success .alert-body");
  }

  async open(link: string) {
    await this.page.goto(link);
  }

  async signIn(password: string) {
    await this.passwordInput.fill(password);
    await this.continueButton.click();
  }

  async chipTexts() {
    return this.texts(this.chips);
  }
}
