import { Locator, Page } from "@playwright/test";
import { BasePage } from "../BasePage";

export class AdminLoginPage extends BasePage {
  readonly heading: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly signInButton: Locator;
  readonly error: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole("heading", { level: 1 });
    this.emailInput = page.getByLabel("Email", { exact: true });
    this.passwordInput = page.getByLabel("Password", { exact: true });
    this.signInButton = page.getByRole("button", { name: "Sign in" });
    this.error = page.locator(".alert-error .alert-body");
  }

  async goto() {
    await this.page.goto("/admin/login");
  }

  async signIn(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.signInButton.click();
  }
}
