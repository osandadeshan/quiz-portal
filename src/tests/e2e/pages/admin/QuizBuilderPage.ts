import { Locator, Page } from "@playwright/test";
import { BasePage } from "../BasePage";
import { QuestionType, QuizQuestion } from "../../data/quiz";

export interface BuilderQuestionState {
  type: string | undefined;
  text: string;
  options: string[];
  correct: string[];
}

export type ResultsVisibility = "full" | "score" | "none";

export class QuizBuilderPage extends BasePage {
  readonly heading: Locator;
  readonly titleInput: Locator;
  readonly descriptionInput: Locator;
  readonly durationInput: Locator;
  readonly shuffleSwitch: Locator;
  readonly saveStatus: Locator;
  readonly saveButton: Locator;
  readonly questionCount: Locator;
  readonly questionCards: Locator;
  readonly outlineItems: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole("heading", { level: 1 });
    this.titleInput = page.getByLabel("Title", { exact: true });
    this.descriptionInput = page.getByLabel("Description (optional)");
    this.durationInput = page.getByLabel("Time limit");
    this.shuffleSwitch = page.getByRole("checkbox", { name: /Shuffle answer options/ });
    this.saveStatus = page.locator("#save-status");
    this.saveButton = page.locator("#save-btn");
    this.questionCount = page.locator("#q-count");
    this.questionCards = page.locator("#questions .q-card");
    this.outlineItems = page.locator("#outline li .t");
  }

  resultsOption(value: ResultsVisibility): Locator {
    return this.page.locator(`input[name="show-results"][value="${value}"]`);
  }

  card(index: number): Locator {
    return this.page.locator(`#questions .q-card[data-q="${index}"]`);
  }

  typeButton(index: number, type: QuestionType): Locator {
    return this.card(index).locator(`[data-action="type"][data-type="${type}"]`);
  }

  questionText(index: number): Locator {
    return this.card(index).locator('[data-input="text"]');
  }

  optionInputs(index: number): Locator {
    return this.card(index).locator('[data-input="option"]');
  }

  addOptionButton(index: number): Locator {
    return this.card(index).getByRole("button", { name: "Add option" });
  }

  addQuestionButton(type: QuestionType): Locator {
    return this.page.locator(`#add-menu [data-add="${type}"]`);
  }

  async goto() {
    await this.page.goto("/admin/quizzes/new");
  }

  async fillDetails(title: string, description: string, minutes: number) {
    await this.titleInput.fill(title);
    await this.descriptionInput.fill(description);
    await this.durationInput.fill(String(minutes));
  }

  async chooseResultsVisibility(value: ResultsVisibility) {
    await this.resultsOption(value).check();
  }

  /** Fill question `index` exactly the way a person would in the UI. */
  async fillQuestion(index: number, q: QuizQuestion) {
    if (index > 0) {
      await this.addQuestionButton(q.type).scrollIntoViewIfNeeded();
      await this.addQuestionButton(q.type).click();
    } else {
      await this.typeButton(0, q.type).click();
    }
    await this.questionText(index).fill(q.text);

    if (q.type === "yesno") {
      await this.yesNoButton(index, q.correct[0] as "Yes" | "No").click();
      return;
    }
    // Match the number of option boxes to the question.
    while ((await this.optionInputs(index).count()) < q.options.length) await this.addOptionButton(index).click();
    while ((await this.optionInputs(index).count()) > q.options.length) {
      await this.card(index).locator('[data-action="remove-opt"]').last().click();
    }
    for (let j = 0; j < q.options.length; j++) await this.optionInputs(index).nth(j).fill(q.options[j]);
    for (const c of q.correct) {
      const j = q.options.indexOf(c);
      await this.card(index).locator(`.correct-toggle[data-o="${j}"]`).click();
    }
  }

  yesNoButton(index: number, answer: "Yes" | "No"): Locator {
    return this.card(index).locator(`.yesno-opt[data-o="${answer === "Yes" ? 0 : 1}"]`);
  }

  /** What the builder currently holds for question `index`, read from the UI. */
  async readQuestion(index: number): Promise<BuilderQuestionState> {
    const card = this.card(index);
    const type = await card.locator('[data-action="type"][aria-pressed="true"]').getAttribute("data-type");
    const text = await this.questionText(index).inputValue();
    if (type === "yesno") {
      const buttons = card.locator(".yesno-opt");
      const labels = (await buttons.allInnerTexts()).map((t) => t.trim());
      const pressed = await buttons.evaluateAll((els) => els.map((e) => e.getAttribute("aria-pressed") === "true"));
      return { type, text, options: labels, correct: labels.filter((_, i) => pressed[i]) };
    }
    const options: string[] = [];
    for (const input of await this.optionInputs(index).all()) options.push(await input.inputValue());
    const pressed = await card.locator(".correct-toggle").evaluateAll((els) => els.map((e) => e.getAttribute("aria-pressed") === "true"));
    return { type: type ?? undefined, text, options, correct: options.filter((_, i) => pressed[i]) };
  }

  async save() {
    await this.saveButton.scrollIntoViewIfNeeded();
    await this.saveButton.click();
  }
}
