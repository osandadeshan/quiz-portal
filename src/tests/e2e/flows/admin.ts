import { expect } from "@playwright/test";
import type { AdminApp } from "../fixtures/test";
import { ScenarioSteps } from "../support/steps";
import { ADMIN, APP_URL } from "../support/env";
import { QUIZ_TITLE } from "../data/quiz";
import { run } from "../support/run-state";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Steps "admin.openLogin" and "admin.signIn". */
export async function signInAsAdmin(steps: ScenarioSteps, admin: AdminApp) {
  steps.use(admin.page);
  await steps.step(
    "admin.openLogin",
    () => admin.login.goto(),
    async () => {
      await expect(admin.page).toHaveURL(`${APP_URL}/admin/login`);
      await expect(admin.login.heading).toHaveText("Admin sign in");
      await expect(admin.login.emailInput).toBeVisible();
      await expect(admin.login.emailInput).toHaveValue("");
      await expect(admin.login.passwordInput).toHaveAttribute("type", "password");
      await expect(admin.login.signInButton).toBeEnabled();
      await expect(admin.login.error).toHaveCount(0);
    }
  );
  await steps.step(
    "admin.signIn",
    () => admin.login.signIn(ADMIN.email, ADMIN.password),
    async () => {
      await expect(admin.page).toHaveURL(`${APP_URL}/admin`);
      await expect(admin.dashboard.heading).toHaveText("Quizzes");
      await expect(admin.dashboard.topBar.accountName).toHaveText(ADMIN.name);
    }
  );
}

/** Step "admin.openQuiz": open the quiz created in E2E-02 from its dashboard card. */
export async function openQuizFromDashboard(steps: ScenarioSteps, admin: AdminApp, extraChecks?: () => Promise<void>) {
  await steps.step(
    "admin.openQuiz",
    () => admin.dashboard.quizCard(QUIZ_TITLE).open(),
    async () => {
      expect(run.quizPath, "E2E-02 must have created the quiz").not.toBe("");
      await expect(admin.page).toHaveURL(new RegExp(`${escape(APP_URL + run.quizPath)}$`));
      await expect(admin.quiz.heading).toHaveText(QUIZ_TITLE);
      await expect(admin.quiz.statusBadge).toHaveText("Active");
      await expect(admin.quiz.tab("Results")).toHaveClass(/\bactive\b/);
      if (extraChecks) await extraChecks();
    }
  );
}

export { escape };
