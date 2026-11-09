import { test as base, expect, Browser, BrowserContext, Page } from "@playwright/test";
import * as allure from "allure-js-commons";
import { scenarioByTitle } from "../scenarios/scenarios";
import { ScenarioSteps } from "../support/steps";
import { APP_URL } from "../support/env";
import { AdminLoginPage } from "../pages/admin/AdminLoginPage";
import { DashboardPage } from "../pages/admin/DashboardPage";
import { QuizBuilderPage } from "../pages/admin/QuizBuilderPage";
import { QuizPage } from "../pages/admin/QuizPage";
import { AttemptPage } from "../pages/admin/AttemptPage";
import { MailboxPage } from "../pages/mail/MailboxPage";
import { ParticipantLoginPage } from "../pages/participant/ParticipantLoginPage";
import { StartPage } from "../pages/participant/StartPage";
import { TakeQuizPage } from "../pages/participant/TakeQuizPage";
import { ResultPage } from "../pages/participant/ResultPage";

/** Every page object an admin uses, bound to one browser page. */
export class AdminApp {
  readonly login: AdminLoginPage;
  readonly dashboard: DashboardPage;
  readonly builder: QuizBuilderPage;
  readonly quiz: QuizPage;
  readonly attempt: AttemptPage;
  readonly mailbox: MailboxPage;
  constructor(readonly page: Page) {
    this.login = new AdminLoginPage(page);
    this.dashboard = new DashboardPage(page);
    this.builder = new QuizBuilderPage(page);
    this.quiz = new QuizPage(page);
    this.attempt = new AttemptPage(page);
    this.mailbox = new MailboxPage(page);
  }
}

/** Every page object a participant uses, in their own private browser session. */
export class ParticipantApp {
  readonly mailbox: MailboxPage;
  readonly login: ParticipantLoginPage;
  readonly start: StartPage;
  readonly take: TakeQuizPage;
  readonly result: ResultPage;
  constructor(readonly page: Page) {
    this.mailbox = new MailboxPage(page);
    this.login = new ParticipantLoginPage(page);
    this.start = new StartPage(page);
    this.take = new TakeQuizPage(page);
    this.result = new ResultPage(page);
  }
}

const SEVERITY = { "P1 - Critical": "critical", "P2 - High": "normal", "P3 - Medium": "minor" } as const;

type Fixtures = {
  /** The documented scenario for this test (looked up by test title) and its step runner. */
  steps: ScenarioSteps;
  admin: AdminApp;
  /** Opens a fresh, isolated browser session (like an incognito window) for a participant. */
  newParticipant: () => Promise<ParticipantApp>;
};

async function freshContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ baseURL: APP_URL, viewport: { width: 1280, height: 800 }, acceptDownloads: true, colorScheme: "light" });
}

export const test = base.extend<Fixtures>({
  steps: async ({ page }, use, testInfo) => {
    const scenario = scenarioByTitle(testInfo.title);
    if (!scenario) {
      throw new Error(`Test "${testInfo.title}" has no matching scenario. Its title must equal "<id> <title>" from scenarios.ts.`);
    }
    await allure.allureId(scenario.id);
    await allure.severity(SEVERITY[scenario.priority]);
    await allure.epic("Quiz Portal E2E");
    await allure.feature(scenario.component);
    await allure.story(scenario.title);
    await allure.label("priority", scenario.priority);
    await allure.description(`**Component:** ${scenario.component}\n\n**Priority:** ${scenario.priority}\n\n**Preconditions:** ${scenario.preconditions}`);
    const steps = new ScenarioSteps(scenario, testInfo).use(page);
    await use(steps);
    if (testInfo.status === "passed") steps.assertAllStepsRan();
  },

  admin: async ({ page }, use) => {
    await use(new AdminApp(page));
  },

  newParticipant: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async () => {
      const ctx = await freshContext(browser);
      contexts.push(ctx);
      return new ParticipantApp(await ctx.newPage());
    });
    for (const c of contexts) await c.close();
  },
});

export { expect };
