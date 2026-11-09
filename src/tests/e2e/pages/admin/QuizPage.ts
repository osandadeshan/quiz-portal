import { Download, Locator, Page } from "@playwright/test";
import { BasePage } from "../BasePage";

export type QuizTab = "Results" | "Participants" | "Questions";

export interface ResultRow {
  rank: string;
  name: string;
  email: string;
  percent: string;
  fraction: string;
  timeTaken: string;
  autoSubmitted: boolean;
}

export interface QuestionTabItem {
  text: string;
  typeLabel: string;
  options: { text: string; correct: boolean; picks: string | null }[];
  correctPercent: string | null;
}

/** An admin's quiz page: header, counters and the Results / Participants / Questions tabs. */
export class QuizPage extends BasePage {
  readonly heading: Locator;
  readonly statusBadge: Locator;
  readonly metaItems: Locator;
  readonly allQuizzesLink: Locator;

  // Results tab
  readonly resultsEmptyTitle: Locator;
  readonly resultRows: Locator;
  readonly visibleResultRows: Locator;
  readonly resultsSearch: Locator;
  readonly exportCsvButton: Locator;

  // Participants tab
  readonly inviteForm: Locator;
  readonly recipientsInput: Locator;
  readonly recipientChips: Locator;
  readonly inviteButton: Locator;
  readonly noEmailSetupNotice: Locator;
  readonly participantsCard: Locator;
  readonly participantsSummary: Locator;
  readonly participantsEmptyTitle: Locator;
  readonly participantRows: Locator;
  /** "Share invitations" panel, shown only when emails could not be sent automatically. */
  readonly sharePanel: Locator;

  // Questions tab
  readonly questionItems: Locator;
  readonly statsNote: Locator;
  readonly lockedNotice: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.locator(".page-header h1");
    this.statusBadge = page.locator(".page-header .badge").first();
    this.metaItems = page.locator(".page-header .meta-line > span");
    this.allQuizzesLink = page.locator(".breadcrumb").getByRole("link", { name: "All quizzes" });

    this.resultsEmptyTitle = page.locator(".empty h3");
    this.resultRows = page.locator("tr[data-result-row]");
    this.visibleResultRows = page.locator("tr[data-result-row]:not(.hidden)");
    this.resultsSearch = page.getByPlaceholder("Search by name or email");
    this.exportCsvButton = page.locator(".toolbar").getByRole("link", { name: "Export CSV" });

    this.inviteForm = page.locator("#invite");
    this.recipientsInput = page.getByLabel("Email addresses");
    this.recipientChips = page.locator("[data-recipient-preview] .badge");
    this.inviteButton = page.locator("[data-invite-submit]");
    this.noEmailSetupNotice = this.inviteForm.getByText("No email setup needed.");
    this.participantsCard = page.locator(".split > .card").nth(1);
    this.participantsSummary = this.participantsCard.locator(".card-header .desc");
    this.participantsEmptyTitle = this.participantsCard.locator(".empty h3");
    this.participantRows = this.participantsCard.locator("tbody tr");
    this.sharePanel = page.locator(".share-panel");

    this.questionItems = page.locator(".card > .review-item");
    this.statsNote = page.locator("p.small.muted").filter({ hasText: /Based on \d+ submitted attempts?\./ });
    this.lockedNotice = page.locator(".alert-info").filter({ hasText: "Questions are locked" });
  }

  tab(name: QuizTab): Locator {
    return this.page.getByRole("navigation", { name: "Quiz sections" }).getByRole("link", { name: new RegExp(`^${name}\\b`) });
  }

  async openTab(name: QuizTab) {
    await this.tab(name).click();
  }

  /** Value of a counter in the stats row, e.g. stat("Invited") → "3". */
  stat(label: string): Locator {
    return this.page.locator(".stats .stat").filter({ has: this.page.locator(".stat-label", { hasText: new RegExp(`^${label}$`) }) }).locator(".stat-value");
  }

  async metaTexts(): Promise<string[]> {
    return this.texts(this.metaItems);
  }

  // ---------- Results ----------
  resultRow(name: string): Locator {
    return this.resultRows.filter({ has: this.page.locator(".person-name", { hasText: new RegExp(`^${name}$`) }) });
  }

  viewAnswersButton(name: string): Locator {
    return this.resultRow(name).getByRole("link", { name: /View answers/ });
  }

  async readResultRows(): Promise<ResultRow[]> {
    return this.visibleResultRows.evaluateAll((rows) =>
      rows.map((r) => {
        const t = (sel: string) => (r.querySelector(sel)?.textContent || "").replace(/\s+/g, " ").trim();
        const cells = r.querySelectorAll("td");
        return {
          rank: t(".rank"),
          name: t(".person-name"),
          email: t(".person-email"),
          percent: t(".score-num"),
          fraction: t(".score-cell .small"),
          timeTaken: (cells[3]?.textContent || "").trim(),
          autoSubmitted: Boolean(r.querySelector(".badge-warning")),
        };
      })
    );
  }

  async searchResults(text: string) {
    await this.resultsSearch.fill(text);
  }

  async exportCsv(): Promise<{ download: Download; filename: string; content: string }> {
    const [download] = await Promise.all([this.page.waitForEvent("download"), this.exportCsvButton.click()]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    return { download, filename: download.suggestedFilename(), content: Buffer.concat(chunks).toString("utf8") };
  }

  // ---------- Participants ----------
  async typeRecipients(lines: string[]) {
    await this.recipientsInput.fill(lines.join("\n"));
  }

  async sendInvitations() {
    await this.inviteButton.click();
  }

  participantRow(email: string): Locator {
    return this.participantRows.filter({ has: this.page.locator(".person-email", { hasText: new RegExp(`^${email.replace(/[.]/g, "\\.")}$`) }) });
  }

  participantName(email: string): Locator {
    return this.participantRow(email).locator(".person-name");
  }

  participantStatus(email: string): Locator {
    return this.participantRow(email).locator("td").nth(1).locator(".badge");
  }

  participantDeliveryNote(email: string): Locator {
    return this.participantRow(email).locator(".person .small");
  }

  // ---------- Questions ----------
  async readQuestionItems(): Promise<QuestionTabItem[]> {
    return this.questionItems.evaluateAll((items) =>
      items.map((el) => ({
        text: (el.querySelector(".review-q")?.textContent || "").trim(),
        typeLabel: (el.querySelector(".review-type")?.textContent || "").replace(/\s+/g, " ").trim(),
        correctPercent: el.querySelector(".q-stat .score-num")?.textContent?.trim() ?? null,
        options: [...el.querySelectorAll(".review-opts li")].map((li) => ({
          text: (li.querySelector(":scope > span:nth-of-type(2)")?.textContent || "").trim(),
          correct: Boolean(li.querySelector(".badge-success")),
          picks: li.querySelector(".tag .small")?.textContent?.trim() ?? null,
        })),
      }))
    );
  }
}
