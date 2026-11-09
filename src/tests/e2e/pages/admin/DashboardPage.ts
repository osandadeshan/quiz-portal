import { Locator, Page } from "@playwright/test";
import { BasePage } from "../BasePage";
import { TopBar } from "../components/TopBar";

export class DashboardPage extends BasePage {
  readonly topBar: TopBar;
  readonly heading: Locator;
  readonly newQuizButton: Locator;

  constructor(page: Page) {
    super(page);
    this.topBar = new TopBar(page);
    this.heading = page.getByRole("heading", { level: 1 });
    this.newQuizButton = page.locator(".page-header").getByRole("link", { name: "New quiz" });
  }

  async goto() {
    await this.page.goto("/admin");
  }

  quizCard(title: string): QuizCard {
    return new QuizCard(this.page.locator("a.quiz-card").filter({ has: this.page.getByRole("heading", { name: title, exact: true }) }));
  }
}

export class QuizCard {
  readonly statusBadge: Locator;
  readonly facts: Locator;
  readonly progress: Locator;
  readonly average: Locator;

  constructor(readonly root: Locator) {
    this.statusBadge = root.locator(".row .badge").first();
    this.facts = root.locator(".facts > span");
    this.progress = root.locator(".progress-line");
    this.average = root.locator(".row .small.muted");
  }

  async open() {
    await this.root.click();
  }
}
