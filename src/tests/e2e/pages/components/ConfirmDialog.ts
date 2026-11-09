import { Locator, Page } from "@playwright/test";

/** The shared "Are you sure?" dialog (views/partials/foot.ejs, opened by ui.js for data-confirm forms). */
export class ConfirmDialog {
  readonly root: Locator;
  readonly title: Locator;
  readonly text: Locator;
  readonly confirmButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page) {
    this.root = page.locator("dialog#confirm-modal");
    this.title = this.root.locator("[data-confirm-title]");
    this.text = this.root.locator("[data-confirm-text]");
    this.confirmButton = this.root.locator("[data-confirm-ok]");
    this.cancelButton = this.root.getByRole("button", { name: "Cancel" });
  }
}
