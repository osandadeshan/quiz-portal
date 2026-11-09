import { Locator, Page } from "@playwright/test";
import { BasePage } from "../BasePage";
import { AnswerReview } from "../components/AnswerReview";

/** /q/:token/result — the participant's result. */
export class ResultPage extends BasePage {
  readonly submittedBadge: Locator;
  readonly percent: Locator;
  readonly correctOfTotal: Locator;
  readonly headline: Locator;
  readonly chips: Locator;
  readonly reviewHeading: Locator;
  readonly review: AnswerReview;

  constructor(page: Page) {
    super(page);
    this.submittedBadge = page.locator(".take-top .badge");
    this.percent = page.locator(".score-ring .pct");
    this.correctOfTotal = page.locator(".score-ring .of");
    this.headline = page.locator(".result-hero h1");
    this.chips = page.locator(".result-facts .chip");
    this.reviewHeading = page.getByRole("heading", { name: "Review your answers" });
    this.review = new AnswerReview(page);
  }

  async chipTexts() {
    return this.texts(this.chips);
  }
}
