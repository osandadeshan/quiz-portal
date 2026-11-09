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

  /**
   * Click Sign in, then press Enter while the first sign-in is still loading,
   * like an impatient person on a slow first load. (A second mouse click is
   * already blocked by the button's loading style; the keyboard isn't.) The first request is held
   * back for a moment (as a cold start would) so the second click really lands
   * mid-flight; then waits for the page to settle. Returns how many sign-in
   * requests the browser sent (the page must send exactly one).
   */
  async signInThenPressEnter(email: string, password: string): Promise<number> {
    let posts = 0;
    const isSignIn = (r: import("@playwright/test").Request) => r.method() === "POST" && new URL(r.url()).pathname === "/admin/login";
    const count = (r: import("@playwright/test").Request) => {
      if (isSignIn(r)) posts++;
    };
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.page.route("**/admin/login", async (route) => {
      if (isSignIn(route.request())) await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    this.page.on("request", count);
    try {
      // Don't wait for the sign-in to finish: the point is to act while it's loading.
      await this.signInButton.click({ noWaitAfter: true });
      await this.page.waitForTimeout(400); // the person waits a moment, then presses Enter
      // The raw keyboard, not a locator: locator actions wait for the pending
      // navigation, a real key press doesn't. Focus is still on Sign in.
      await this.page.keyboard.press("Enter");
      await this.page.waitForLoadState("load");
      await this.page.waitForURL((u) => u.pathname !== "/admin/login" || u.search !== "", { timeout: 15_000 }).catch(() => {});
      await this.page.waitForLoadState("load");
    } finally {
      this.page.off("request", count);
      await this.page.unroute("**/admin/login");
    }
    return posts;
  }
}
