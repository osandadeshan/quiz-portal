import { Locator, Page } from "@playwright/test";

/** Shared helpers for every page object. Locators live in page objects only, never in specs. */
export abstract class BasePage {
  constructor(readonly page: Page) {}

  /** Path part of the current URL, e.g. "/admin/quizzes/3". */
  path(): string {
    return new URL(this.page.url()).pathname;
  }

  searchParam(name: string): string | null {
    return new URL(this.page.url()).searchParams.get(name);
  }

  /** Trimmed, whitespace-collapsed text of every element matched by `locator`. */
  protected async texts(locator: Locator): Promise<string[]> {
    return (await locator.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  }

  /** Green/red/yellow message boxes (the flash partial). */
  flash(kind: "success" | "error" | "warning" | "info"): Locator {
    return this.page.locator(`.alert.alert-${kind} .alert-body`);
  }
}
