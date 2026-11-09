import { FrameLocator, Locator, Page } from "@playwright/test";
import { BasePage } from "../BasePage";
import { MAILBOX_URL } from "../../support/env";

export interface InvitationEmail {
  from: string;
  to: string;
  subject: string;
  greeting: string;
  heading: string;
  summary: string;
  shownEmail: string;
  password: string;
  link: string;
  fallbackLink: string;
  plainText: string;
}

/**
 * The disposable test mailbox (Mailpit web UI, pinned to v1.33.1 in
 * support/start-stack.cjs). Every email the app sends lands here.
 */
export class MailboxPage extends BasePage {
  readonly searchInput: Locator;
  readonly messageRows: Locator;
  readonly headerTable: Locator;
  readonly htmlTab: Locator;
  readonly textTab: Locator;
  readonly plainText: Locator;
  readonly html: FrameLocator;

  constructor(page: Page) {
    super(page);
    this.searchInput = page.getByLabel("Search mailbox");
    this.messageRows = page.locator('[data-testid="message-row"]');
    this.headerTable = page.locator("table.messageHeaders");
    this.htmlTab = page.getByRole("tab", { name: "HTML", exact: true });
    this.textTab = page.getByRole("tab", { name: "Text", exact: true });
    this.plainText = page.locator("#nav-plain-text .text-view");
    this.html = page.frameLocator("#preview-html");
  }

  async goto() {
    await this.page.goto(MAILBOX_URL);
  }

  async search(query: string) {
    await this.searchInput.fill(query);
    await this.searchInput.press("Enter");
    await this.page.waitForURL(/\/search\?q=/);
  }

  rowSubject(row: Locator): Locator {
    return row.locator('[data-testid="message-subject"]');
  }

  /** Recipient lines ("To: someone@example.com") of the listed messages. */
  async listedRecipients(): Promise<string[]> {
    return this.messageRows.evaluateAll((rows) =>
      rows.map((r) => {
        const line = [...r.querySelectorAll(".text-muted")].map((e) => e.textContent || "").find((t) => t.trim().startsWith("To:")) || "";
        return line.replace(/^\s*To:\s*/, "").trim();
      })
    );
  }

  async listedSubjects(): Promise<string[]> {
    return this.texts(this.messageRows.locator('[data-testid="message-subject"]'));
  }

  async listedSenders(): Promise<string[]> {
    return this.texts(this.messageRows.locator("b[title^='From:']"));
  }

  async openMessage(index = 0) {
    await this.messageRows.nth(index).click();
    await this.page.waitForURL(/\/view\//);
  }

  header(name: "From" | "To" | "Subject" | "Date"): Locator {
    return this.headerTable.locator("tr").filter({ has: this.page.locator("th", { hasText: new RegExp(`^${name}$`) }) }).locator("td");
  }

  /** Read an open invitation email: headers, the HTML body and the plain-text body. */
  async readInvitation(): Promise<InvitationEmail> {
    const from = (await this.header("From").innerText()).replace(/\s+/g, " ").trim();
    const to = (await this.header("To").innerText()).replace(/\s+/g, " ").trim();
    const subject = (await this.header("Subject").innerText()).trim();
    const body = this.html.locator("body");
    await body.waitFor();
    const greeting = (await this.html.locator("p").first().innerText()).trim();
    const heading = (await this.html.locator("h1").innerText()).trim();
    const summary = (await this.html.locator("h1 + p").innerText()).replace(/\s+/g, " ").trim();
    const shownEmail = (await this.html.getByText("Email", { exact: true }).locator("xpath=following-sibling::div[1]").innerText()).trim();
    const password = (await this.html.getByText("Your password", { exact: true }).locator("xpath=following-sibling::div[1]").innerText()).trim();
    const link = (await this.html.getByRole("link", { name: "Open quiz" }).getAttribute("href")) || "";
    const fallbackLink = (await this.html.locator("a").last().getAttribute("href")) || "";
    await this.textTab.click();
    const plainText = await this.plainText.innerText();
    await this.htmlTab.click();
    return { from, to, subject, greeting, heading, summary, shownEmail, password, link, fallbackLink, plainText };
  }
}
