import { Locator, Page } from "@playwright/test";
import { BasePage } from "../BasePage";
import { AnswerReview } from "../components/AnswerReview";

/** Admin view of one participant's attempt (/admin/attempts/:id). */
export class AttemptPage extends BasePage {
  readonly name: Locator;
  readonly email: Locator;
  readonly rank: Locator;
  readonly rankTotal: Locator;
  readonly backToResults: Locator;
  readonly review: AnswerReview;

  constructor(page: Page) {
    super(page);
    const header = page.locator(".card").first();
    this.name = header.locator("h1");
    this.email = header.locator("h1 + .muted");
    this.rank = header.locator(".rank");
    this.rankTotal = header.locator(".rank + .small");
    this.backToResults = page.locator(".breadcrumb a");
    this.review = new AnswerReview(page);
  }

  /** Value of a stat box, e.g. stat("Score") → "70%". */
  stat(label: "Score" | "Correct" | "Time taken" | "Submitted"): Locator {
    return this.page.locator(".stats .stat").filter({ has: this.page.locator(".stat-label", { hasText: new RegExp(`^${label}$`) }) }).locator(".stat-value, .stat-label + div").first();
  }
}
