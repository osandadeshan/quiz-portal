/**
 * API tests: health check, first-run setup, admin authentication, CSRF and quiz
 * validation. Step names and expected results come from scenarios/api-scenarios.ts.
 * No selectors live here; HTML is read through the api/ objects.
 */
import { test, expect } from "../../fixtures/test";
import type { HttpResult } from "../../api/HttpSession";
import { signInAdmin, createQuiz } from "../../flows/api";
import { dbValue } from "../../support/db";
import { ADMIN } from "../../support/env";
import { apiQuiz, apiTitle, API_PASSWORDS } from "../../data/api";
import { API_01, API_02, API_03, API_04 } from "../../scenarios/api-scenarios";

const countAdmins = (email: string) => dbValue<number>("SELECT count(*)::int FROM admins WHERE email=$1", [email]);
const countQuizzes = (title: string) => dbValue<number>("SELECT count(*)::int FROM quizzes WHERE title=$1", [title]);

test.describe("API · platform", () => {
  test(API_01.testTitle, async ({ steps, api }) => {
    const guest = await api.admin("guest");

    await steps.step(
      "health",
      () => guest.get("/healthz"),
      async () => {
        const res = await guest.get("/healthz");
        expect(res.status).toBe(200);
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.contentType).toMatch(/^application\/json/);
        expect(res.json()).toEqual({ ok: true });
      }
    );

    let setupPage!: HttpResult;
    await steps.step(
      "setupPage",
      async () => (setupPage = await guest.openSetup()),
      async () => {
        expect(setupPage.status).toBe(302);
        expect(setupPage.location).toBe("/admin/login");
      }
    );

    let setupPost!: HttpResult;
    await steps.step(
      "setupPost",
      async () => {
        await guest.openLogin();
        setupPost = await guest.submitSetup({ name: "Intruder", email: "api01.intruder@example.com", password: API_PASSWORDS.intruder, confirm: API_PASSWORDS.intruder });
      },
      async () => {
        expect(setupPost.status).toBe(302);
        expect(setupPost.location).toBe("/admin/login");
        expect(await countAdmins("api01.intruder@example.com")).toBe(0);
        expect(await countAdmins(ADMIN.email)).toBe(1);
      }
    );
  });

  test(API_02.testTitle, async ({ steps, api }) => {
    const admin = await api.admin();
    const title = apiTitle("API-02 Signed-out quiz");

    let dash!: HttpResult;
    await steps.step(
      "dashboard",
      async () => (dash = await admin.dashboard()),
      async () => {
        expect(dash.status).toBe(302);
        expect(dash.location).toBe("/admin/login");
      }
    );

    let json!: HttpResult;
    await steps.step(
      "json",
      async () => {
        await admin.openLogin();
        json = await admin.createQuiz(apiQuiz(title));
      },
      async () => {
        expect(json.status).toBe(401);
        expect(json.json()).toEqual({ error: "Please sign in again." });
        expect(await countQuizzes(title)).toBe(0);
      }
    );

    let wrong!: HttpResult;
    await steps.step(
      "wrongPassword",
      async () => (wrong = await admin.signIn(ADMIN.email, "not-the-password")),
      async () => {
        expect(wrong.status).toBe(401);
        expect(admin.loginError(wrong)).toBe("That email and password don't match. Check them and try again.");
        const still = await admin.dashboard();
        expect(still.status).toBe(302);
        expect(still.location).toBe("/admin/login");
      }
    );

    let ok!: HttpResult;
    await steps.step(
      "signIn",
      async () => (ok = await admin.signIn(ADMIN.email, ADMIN.password)),
      async () => {
        expect(ok.status).toBe(302);
        expect(ok.location).toBe("/admin");
        const home = await admin.dashboard();
        expect(home.status).toBe(200);
        expect(admin.heading(home)).toBe("Quizzes");
      }
    );

    let out!: HttpResult;
    await steps.step(
      "signOut",
      async () => (out = await admin.http.postForm("/admin/logout", {})),
      async () => {
        expect(out.status).toBe(302);
        expect(out.location).toBe("/admin/login");
        const after = await admin.dashboard();
        expect(after.status).toBe(302);
        expect(after.location).toBe("/admin/login");
      }
    );
  });

  test(API_03.testTitle, async ({ steps, api }) => {
    const admin = await api.admin();
    const title = apiTitle("API-03 CSRF quiz");
    const sessionExpired = { error: "Your session expired. Reload the page and try again." };

    await steps.step("signIn", () => signInAdmin(admin), async () => expect((await admin.dashboard()).status).toBe(200));

    let bad!: HttpResult;
    await steps.step(
      "badHeader",
      async () => (bad = await admin.createQuiz(apiQuiz(title), { csrf: "nope" })),
      async () => {
        expect(bad.status).toBe(403);
        expect(bad.json()).toEqual(sessionExpired);
      }
    );

    let none!: HttpResult;
    await steps.step(
      "noHeader",
      async () => (none = await admin.createQuiz(apiQuiz(title), { csrf: null })),
      async () => {
        expect(none.status).toBe(403);
        expect(none.json()).toEqual(sessionExpired);
      }
    );

    let form!: HttpResult;
    await steps.step(
      "formNoToken",
      async () => (form = await admin.http.postForm("/admin/team", { name: "CSRF Victim", email: "api03.victim@example.com", password: API_PASSWORDS.victim }, { csrf: null })),
      async () => {
        expect(form.status).toBe(403);
        expect(await countAdmins("api03.victim@example.com")).toBe(0);
      }
    );

    let dash!: HttpResult;
    await steps.step(
      "nothingCreated",
      async () => (dash = await admin.dashboard()),
      async () => {
        expect(dash.status).toBe(200);
        expect(admin.dashboardTitles(dash)).not.toContain(title);
        expect(await countQuizzes(title)).toBe(0);
      }
    );
  });

  test(API_04.testTitle, async ({ steps, api }) => {
    const admin = await api.admin();
    const title = apiTitle("API-04 Valid quiz");
    type Errors = { errors: Record<string, unknown> };

    await steps.step("signIn", () => signInAdmin(admin), async () => expect((await admin.dashboard()).status).toBe(200));

    let empty!: HttpResult;
    await steps.step(
      "empty",
      async () => (empty = await admin.createQuiz({ title: "", durationMinutes: 0, questions: [] })),
      async () => {
        expect(empty.status).toBe(422);
        expect(empty.json<Errors>().errors).toEqual({
          title: "Give your quiz a title.",
          durationMinutes: "Duration must be a whole number between 1 and 600 minutes.",
          questions: "Add at least one question.",
          questionErrors: [],
        });
      }
    );

    let malformed!: HttpResult;
    await steps.step(
      "malformed",
      async () => (malformed = await admin.createQuiz({ title: "x", durationMinutes: 5, questions: [null, { options: [null, 7] }] })),
      async () => {
        expect(malformed.status).toBe(422);
        const perQuestion = ["Write the question.", "Add at least two answer options.", "Mark the correct answer."];
        expect(malformed.json<Errors>().errors).toEqual({ questionErrors: [perQuestion, perQuestion] });
        const health = await admin.get("/healthz");
        expect(health.status).toBe(200);
        expect(health.json()).toEqual({ ok: true });
      }
    );

    let long!: HttpResult;
    await steps.step(
      "tooLong",
      async () => (long = await admin.createQuiz(apiQuiz("T".repeat(201)))),
      async () => {
        expect(long.status).toBe(422);
        expect(long.json<Errors>().errors.title).toBe("Keep the title under 200 characters.");
        expect(await countQuizzes("T".repeat(201))).toBe(0);
      }
    );

    let quizId = 0;
    await steps.step(
      "valid",
      async () => (quizId = await createQuiz(admin, title)),
      async () => {
        expect(await countQuizzes(title)).toBe(1);
        expect(await dbValue("SELECT string_agg(type, ',' ORDER BY position) FROM questions WHERE quiz_id=$1", [quizId])).toBe("single,yesno,multiple");
        expect(await dbValue<number>("SELECT count(*)::int FROM options o JOIN questions q ON q.id=o.question_id WHERE q.quiz_id=$1", [quizId])).toBe(8);
        expect(await dbValue<number>("SELECT count(*)::int FROM options o JOIN questions q ON q.id=o.question_id WHERE q.quiz_id=$1 AND o.is_correct", [quizId])).toBe(4);
      }
    );

    let view!: HttpResult;
    await steps.step(
      "view",
      async () => (view = await admin.quiz(quizId, "questions")),
      async () => {
        expect(view.status).toBe(200);
        expect(admin.heading(view)).toBe(title);
      }
    );
  });
});
