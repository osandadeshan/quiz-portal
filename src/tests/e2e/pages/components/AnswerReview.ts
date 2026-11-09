import { Locator, Page } from "@playwright/test";

export type ReviewState = "correct" | "incorrect" | "unanswered";

export interface ReviewOption {
  text: string;
  /** Badges shown on the option, e.g. ["Selected"], ["Your answer"], ["Correct answer"]. */
  badges: string[];
  /** The filled selection marker (what the person picked). */
  picked: boolean;
  /** Row is highlighted as a correct option. */
  highlightedCorrect: boolean;
}

export interface ReviewItem {
  number: number;
  text: string;
  state: ReviewState;
  typeLabel: string;
  options: ReviewOption[];
  visible: boolean;
}

/**
 * The answer review list (views/partials/review.ejs), shown to participants on
 * their result page and to admins on a participant's answers page.
 */
export class AnswerReview {
  readonly items: Locator;
  readonly visibleItems: Locator;

  constructor(private readonly page: Page) {
    this.items = page.locator(".review-item[data-answer-state]");
    this.visibleItems = page.locator(".review-item[data-answer-state]:not(.hidden)");
  }

  filterButton(name: "All" | "Incorrect" | "Correct"): Locator {
    return this.page.locator(".filter-pills").getByRole("button", { name, exact: true });
  }

  async read(): Promise<ReviewItem[]> {
    return this.items.evaluateAll((els) =>
      els.map((el) => {
        const status = el.querySelector(".review-status")!;
        const state = status.classList.contains("ok") ? "correct" : status.classList.contains("bad") ? "incorrect" : "unanswered";
        const q = (el.querySelector(".review-q")?.textContent || "").replace(/\s+/g, " ").trim();
        const m = q.match(/^(\d+)\.\s*(.*)$/);
        const options = [...el.querySelectorAll(".review-opts li")].map((li) => ({
          text: (li.querySelector(":scope > span:nth-of-type(2)")?.textContent || "").trim(),
          badges: [...li.querySelectorAll(".tag .badge")].map((b) => (b.textContent || "").trim()),
          picked: Boolean(li.querySelector(".sel.on")),
          highlightedCorrect: li.classList.contains("correct"),
        }));
        return {
          number: m ? Number(m[1]) : NaN,
          text: m ? m[2] : q,
          state,
          typeLabel: (el.querySelector(".review-type")?.textContent || "").replace(/\s+/g, " ").trim(),
          options,
          visible: !el.classList.contains("hidden"),
        };
      })
    ) as Promise<ReviewItem[]>;
  }
}
