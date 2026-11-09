import { Locator, Page } from "@playwright/test";

/** Admin top bar with the account menu. */
export class TopBar {
  readonly accountButton: Locator;
  readonly accountName: Locator;
  /** ui.js moves an open dropdown menu to <body> as `.dropdown-menu.floating`. */
  readonly openMenu: Locator;
  readonly signedInAs: Locator;
  readonly accountLink: Locator;
  readonly signOutButton: Locator;

  constructor(private readonly page: Page) {
    this.accountButton = page.locator('header.topbar summary[aria-label="Account menu"]');
    this.accountName = this.accountButton.locator("span.hide-sm");
    this.openMenu = page.locator(".dropdown-menu.floating");
    this.signedInAs = this.openMenu.locator(".menu-label");
    this.accountLink = this.openMenu.getByRole("link", { name: "Account & password" });
    this.signOutButton = this.openMenu.getByRole("button", { name: "Sign out" });
  }

  async openAccountMenu() {
    await this.accountButton.click();
  }
}
