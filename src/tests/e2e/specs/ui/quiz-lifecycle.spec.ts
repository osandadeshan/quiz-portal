/**
 * Full quiz lifecycle: admin signs in → builds a 10-question quiz → invites three
 * people by email → each reads the invitation in the mailbox and takes the quiz →
 * admin checks the ranking, every answer, statistics and the CSV export.
 *
 * Step names and expected results come from scenarios/scenarios.ts, which also
 * generates src/tests/e2e-test-scenarios.md. No locators live in this file.
 */
import { test, expect } from "../../fixtures/test";
import { signInAsAdmin, openQuizFromDashboard, escape } from "../../flows/admin";
import { completeQuizFromEmail, expectReviewMatches } from "../../flows/participant";
import { ADMIN, APP_URL } from "../../support/env";
import { run } from "../../support/run-state";
import { parseCsv } from "../../support/csv";
import { QUESTIONS, QUIZ, QUIZ_TITLE, CSV_FILENAME, TYPE_LABEL } from "../../data/quiz";
import { PARTICIPANTS, byId, questionNumbersWhere, correctPercent, optionPicks, averagePercent, topPercent } from "../../data/participants";
import { E2E_01, E2E_02, E2E_03, E2E_04, E2E_05, E2E_06, E2E_07, E2E_08, E2E_09, E2E_10, E2E_11 } from "../../scenarios/scenarios";

const N = QUESTIONS.length;
const ranked = [...PARTICIPANTS].sort((a, b) => a.expected.rank - b.expected.rank);
const pickText = (n: number) => `${n} ${n === 1 ? "pick" : "picks"}`;

// Each test builds on the previous one (same quiz, same invitations).
test.describe.configure({ mode: "serial" });

test.describe("Quiz lifecycle", () => {
  test(E2E_01.testTitle, async ({ steps, admin }) => {
    steps.use(admin.page);
    await steps.step(
      "admin.openLogin",
      () => admin.login.goto(),
      async () => {
        await expect(admin.page).toHaveURL(`${APP_URL}/admin/login`);
        await expect(admin.login.heading).toHaveText("Admin sign in");
        await expect(admin.login.emailInput).toHaveValue("");
        await expect(admin.login.passwordInput).toHaveAttribute("type", "password");
        await expect(admin.login.signInButton).toBeEnabled();
      }
    );
    await steps.step(
      "admin.wrongPassword",
      () => admin.login.signIn(ADMIN.email, "not-the-password"),
      async () => {
        await expect(admin.login.error).toHaveText("That email and password don't match. Check them and try again.");
        await expect(admin.page).toHaveURL(`${APP_URL}/admin/login`);
        await expect(admin.login.emailInput).toHaveValue(ADMIN.email);
        await expect(admin.login.heading).toHaveText("Admin sign in");
      }
    );
    await steps.step(
      "admin.signIn",
      () => admin.login.signIn(ADMIN.email, ADMIN.password),
      async () => {
        await expect(admin.page).toHaveURL(`${APP_URL}/admin`);
        await expect(admin.dashboard.heading).toHaveText("Quizzes");
        await expect(admin.dashboard.newQuizButton).toBeVisible();
        await expect(admin.dashboard.topBar.accountName).toHaveText(ADMIN.name);
      }
    );
    await steps.step(
      "admin.accountMenu",
      () => admin.dashboard.topBar.openAccountMenu(),
      async () => {
        const bar = admin.dashboard.topBar;
        await expect(bar.openMenu).toBeVisible();
        await expect(bar.signedInAs).toHaveText(`Signed in as ${ADMIN.email}`, { useInnerText: true });
        await expect(bar.accountLink).toBeVisible();
        await expect(bar.signOutButton).toBeVisible();
      }
    );
  });

  test(E2E_02.testTitle, async ({ steps, admin }) => {
    await signInAsAdmin(steps, admin);
    const b = admin.builder;

    await steps.step(
      "builder.open",
      () => admin.dashboard.newQuizButton.click(),
      async () => {
        await expect(admin.page).toHaveURL(`${APP_URL}/admin/quizzes/new`);
        await expect(b.heading).toHaveText("Create a quiz");
        await expect(b.questionCards).toHaveCount(1);
        await expect(b.typeButton(0, "single")).toHaveAttribute("aria-pressed", "true");
        await expect(b.questionText(0)).toHaveValue("");
        await expect(b.optionInputs(0)).toHaveCount(4);
        await expect(b.saveButton).toHaveText("Create quiz");
      }
    );

    await steps.step(
      "builder.details",
      () => b.fillDetails(QUIZ_TITLE, QUIZ.description, QUIZ.durationMinutes),
      async () => {
        await expect(b.titleInput).toHaveValue(QUIZ_TITLE);
        await expect(b.descriptionInput).toHaveValue(QUIZ.description);
        await expect(b.durationInput).toHaveValue(String(QUIZ.durationMinutes));
        await expect(b.saveStatus).toHaveText("Unsaved changes");
      }
    );

    await steps.step(
      "builder.settings",
      () => b.chooseResultsVisibility("full"),
      async () => {
        await expect(b.shuffleSwitch).toBeChecked();
        await expect(b.resultsOption("full")).toBeChecked();
        await expect(b.resultsOption("score")).not.toBeChecked();
        await expect(b.resultsOption("none")).not.toBeChecked();
      }
    );

    for (let i = 0; i < N; i++) {
      const q = QUESTIONS[i];
      await steps.step(
        `builder.question${i + 1}`,
        () => b.fillQuestion(i, q),
        async () => {
          expect(await b.readQuestion(i)).toEqual({ type: q.type, text: q.text, options: q.options, correct: q.correct });
          await expect(b.questionCount).toHaveText(String(i + 1));
          await expect(b.questionCards).toHaveCount(i + 1);
          await expect(b.outlineItems.nth(i)).toHaveText(q.text);
        }
      );
    }

    await steps.step(
      "builder.save",
      () => b.save(),
      async () => {
        await expect(admin.page).toHaveURL(new RegExp(`${escape(APP_URL)}/admin/quizzes/\\d+\\?tab=participants$`));
        run.quizPath = admin.quiz.path();
        await expect(admin.quiz.flash("success")).toHaveText("Quiz created. Invite participants whenever you're ready.");
        await expect(admin.quiz.heading).toHaveText(QUIZ_TITLE);
        await expect(admin.quiz.statusBadge).toHaveText("Active");
        expect((await admin.quiz.metaTexts()).slice(0, 4)).toEqual([
          `${N} questions`,
          `${QUIZ.durationMinutes} minutes`,
          "Options shuffled per participant",
          "Participants see their score and the correct answers",
        ]);
        await expect(admin.quiz.tab("Participants")).toHaveClass(/\bactive\b/);
      }
    );

    await steps.step(
      "quiz.questionsTab",
      () => admin.quiz.openTab("Questions"),
      async () => {
        await expect(admin.quiz.tab("Questions")).toHaveClass(/\bactive\b/);
        const items = await admin.quiz.readQuestionItems();
        expect(items).toEqual(
          QUESTIONS.map((q) => ({
            text: q.text,
            typeLabel: TYPE_LABEL[q.type],
            correctPercent: null,
            options: q.options.map((o) => ({ text: o, correct: q.correct.includes(o), picks: null })),
          }))
        );
        const types = items.map((i) => i.typeLabel);
        expect(types.filter((t) => t === "Yes / No")).toHaveLength(3);
        expect(types.filter((t) => t === "Single choice")).toHaveLength(3);
        expect(types.filter((t) => t === "Multiple answers")).toHaveLength(4);
        await expect(admin.quiz.statsNote).toHaveCount(0);
        await expect(admin.quiz.lockedNotice).toHaveCount(0);
      }
    );

    await steps.step(
      "dashboard.card",
      () => admin.quiz.allQuizzesLink.click(),
      async () => {
        await expect(admin.page).toHaveURL(`${APP_URL}/admin`);
        const card = admin.dashboard.quizCard(QUIZ_TITLE);
        await expect(card.root).toHaveCount(1);
        await expect(card.statusBadge).toHaveText("Active");
        await expect(card.facts).toHaveText([`${N} questions`, `${QUIZ.durationMinutes} min`]);
        await expect(card.progress).toHaveText("No one invited yet");
        await expect(card.average).toHaveCount(0);
      }
    );
  });

  test(E2E_03.testTitle, async ({ steps, admin }) => {
    await signInAsAdmin(steps, admin);
    const quiz = admin.quiz;

    await openQuizFromDashboard(steps, admin, async () => {
      await expect(quiz.resultsEmptyTitle).toHaveText("No results yet");
      await expect(quiz.stat("Invited")).toHaveText("0");
      await expect(quiz.stat("Started")).toHaveText("0");
      await expect(quiz.stat("Completed")).toHaveText("0");
      await expect(quiz.stat("Average score")).toHaveText("—");
    });

    await steps.step(
      "invite.openTab",
      () => quiz.openTab("Participants"),
      async () => {
        await expect(quiz.tab("Participants")).toHaveClass(/\bactive\b/);
        await expect(quiz.recipientsInput).toHaveValue("");
        await expect(quiz.inviteButton).toBeDisabled();
        await expect(quiz.inviteButton).toHaveText("Send invitations");
        await expect(quiz.noEmailSetupNotice, "SMTP is configured, so emails are sent automatically").toHaveCount(0);
        await expect(quiz.participantsEmptyTitle).toHaveText("No one invited yet");
      }
    );

    await steps.step(
      "invite.type",
      () => quiz.typeRecipients(PARTICIPANTS.map((p) => `${p.name} <${p.email}>`)),
      async () => {
        await expect(quiz.recipientChips).toHaveText(PARTICIPANTS.map((p) => `${p.name} · ${p.email}`));
        await expect(quiz.inviteButton).toBeEnabled();
        await expect(quiz.inviteButton).toHaveText("Send 3 invitations");
      }
    );

    await steps.step(
      "invite.send",
      () => quiz.sendInvitations(),
      async () => {
        await expect(admin.page).toHaveURL(new RegExp(`${escape(run.quizPath)}\\?tab=participants$`));
        await expect(quiz.flash("success")).toHaveText("Invitation sent to 3 people.");
        await expect(quiz.flash("warning")).toHaveCount(0);
        await expect(quiz.flash("error")).toHaveCount(0);
        await expect(quiz.sharePanel, "no manual sharing needed when email works").toHaveCount(0);
        await expect(quiz.participantRows).toHaveCount(3);
        for (const p of PARTICIPANTS) {
          await expect(quiz.participantName(p.email)).toHaveText(p.name);
          await expect(quiz.participantStatus(p.email)).toHaveText("Not started");
          await expect(quiz.participantDeliveryNote(p.email)).toHaveText(/^\s*Emailed [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}\s?[AP]M\s*$/);
        }
        await expect(quiz.participantsSummary).toHaveText("3 invited · 0 completed");
        await expect(quiz.stat("Invited")).toHaveText("3");
        await expect(quiz.stat("Started")).toHaveText("0");
        await expect(quiz.stat("Completed")).toHaveText("0");
      }
    );

    await steps.step(
      "mail.inboxHasThree",
      async () => {
        await admin.mailbox.goto();
        await admin.mailbox.search(`subject:"${QUIZ_TITLE}"`);
      },
      async () => {
        await expect(admin.mailbox.messageRows).toHaveCount(3);
        expect(await admin.mailbox.listedSubjects()).toEqual(Array(3).fill(`You're invited to take "${QUIZ_TITLE}"`));
        expect(await admin.mailbox.listedSenders()).toEqual(Array(3).fill("Quiz Portal"));
        expect((await admin.mailbox.listedRecipients()).sort()).toEqual(PARTICIPANTS.map((p) => p.email).sort());
      }
    );
  });

  for (const [scenario, id] of [[E2E_04, "amaya"], [E2E_05, "daniel"], [E2E_06, "priya"]] as const) {
    test(scenario.testTitle, async ({ steps, newParticipant }) => {
      const session = await newParticipant();
      await completeQuizFromEmail(steps, byId(id), session);
    });
  }

  test(E2E_07.testTitle, async ({ steps, admin }) => {
    await signInAsAdmin(steps, admin);
    const quiz = admin.quiz;
    const card = admin.dashboard.quizCard(QUIZ_TITLE);

    await steps.step(
      "dashboard.cardCompleted",
      () => card.root.scrollIntoViewIfNeeded(),
      async () => {
        await expect(card.statusBadge).toHaveText("Active");
        await expect(card.average).toHaveText(`Avg ${averagePercent}%`);
        await expect(card.progress).toHaveText("3/3 completed");
      }
    );

    await openQuizFromDashboard(steps, admin, async () => {
      await expect(quiz.stat("Invited")).toHaveText("3");
      await expect(quiz.stat("Started")).toHaveText("3");
      await expect(quiz.stat("Completed")).toHaveText("3");
      await expect(quiz.stat("Average score")).toHaveText(`${averagePercent}%`);
      await expect(quiz.stat("Top score")).toHaveText(`${topPercent}%`);
    });

    const expectedRows = ranked.map((p) => ({
      rank: String(p.expected.rank),
      name: p.name,
      email: p.email,
      percent: `${p.expected.percent}%`,
      fraction: `${p.expected.score}/${N}`,
      autoSubmitted: false,
    }));
    const withoutTime = (rows: Awaited<ReturnType<typeof quiz.readResultRows>>) => rows.map(({ timeTaken, ...r }) => r);

    await steps.step(
      "results.ranking",
      () => quiz.resultRows.first().scrollIntoViewIfNeeded(),
      async () => {
        const rows = await quiz.readResultRows();
        expect(withoutTime(rows)).toEqual(expectedRows);
        for (const r of rows) expect(r.timeTaken).toMatch(/^(\d+h \d+m|\d+m \d{2}s|\d+s)$/);
        for (const p of ranked) await expect(quiz.viewAnswersButton(p.name)).toBeVisible();
      }
    );

    await steps.step(
      "results.search",
      () => quiz.searchResults("daniel"),
      async () => {
        await expect(quiz.visibleResultRows).toHaveCount(1);
        expect(withoutTime(await quiz.readResultRows())).toEqual([expectedRows[1]]);
      }
    );

    await steps.step(
      "results.clearSearch",
      () => quiz.searchResults(""),
      async () => {
        await expect(quiz.visibleResultRows).toHaveCount(3);
        expect(withoutTime(await quiz.readResultRows())).toEqual(expectedRows);
      }
    );

    await steps.step(
      "results.participantsTab",
      () => quiz.openTab("Participants"),
      async () => {
        for (const p of PARTICIPANTS) await expect(quiz.participantStatus(p.email)).toHaveText(`Completed · ${p.expected.percent}%`);
        await expect(quiz.participantsSummary).toHaveText("3 invited · 3 completed");
      }
    );
  });

  test(E2E_08.testTitle, async ({ steps, admin }) => {
    await signInAsAdmin(steps, admin);
    await openQuizFromDashboard(steps, admin);
    const { quiz, attempt } = admin;

    for (const p of ranked) {
      await steps.step(
        `attempt.${p.id}.open`,
        () => quiz.viewAnswersButton(p.name).click(),
        async () => {
          await expect(admin.page).toHaveURL(new RegExp(`${escape(APP_URL)}/admin/attempts/\\d+$`));
          await expect(attempt.name).toHaveText(p.name);
          await expect(attempt.email).toHaveText(p.email);
          await expect(attempt.rank).toHaveText(`#${p.expected.rank}`);
          await expect(attempt.rankTotal).toHaveText("of 3");
          await expect(attempt.stat("Score")).toHaveText(`${p.expected.percent}%`);
          await expect(attempt.stat("Correct")).toHaveText(new RegExp(`^${p.expected.score}\\s*/\\s*${N}$`));
        }
      );
      await steps.step(
        `attempt.${p.id}.answers`,
        () => attempt.review.items.first().scrollIntoViewIfNeeded(),
        async () => expectReviewMatches(await attempt.review.read(), p, "Selected")
      );
      const wrong = [...questionNumbersWhere(p, "incorrect"), ...questionNumbersWhere(p, "unanswered")].sort((a, b) => a - b);
      await steps.step(
        `attempt.${p.id}.filter`,
        () => attempt.review.filterButton("Incorrect").click(),
        async () => {
          await expect(attempt.review.filterButton("Incorrect")).toHaveAttribute("aria-pressed", "true");
          await expect(attempt.review.visibleItems).toHaveCount(wrong.length);
          const visible = (await attempt.review.read()).filter((i) => i.visible).map((i) => i.number);
          expect(visible).toEqual(wrong);
        }
      );
      await steps.step(
        `attempt.${p.id}.back`,
        () => attempt.backToResults.click(),
        async () => {
          await expect(admin.page).toHaveURL(new RegExp(`${escape(run.quizPath)}\\?tab=results$`));
          await expect(quiz.tab("Results")).toHaveClass(/\bactive\b/);
          await expect(quiz.resultRows).toHaveCount(3);
        }
      );
    }
  });

  test(E2E_09.testTitle, async ({ steps, newParticipant }) => {
    const p = byId("amaya");
    const creds = run.credentials.get(p.id);
    expect(creds, "E2E-04 must have captured Amaya's credentials").toBeTruthy();
    const session = await newParticipant();
    steps.use(session.page);

    await steps.step(
      "participant.reopenLink",
      () => session.login.open(creds!.link),
      async () => {
        await expect(session.login.quizTitle).toHaveText(QUIZ_TITLE);
        await expect(session.login.completedNotice).toHaveText("You've already completed this quiz. Sign in to see your results.");
      }
    );
    await steps.step(
      "participant.signInAgain",
      () => session.login.signIn(creds!.password),
      async () => {
        await expect(session.page).toHaveURL(`${creds!.link}/result`);
        await expect(session.result.percent).toHaveText(`${p.expected.percent}%`);
        await expect(session.result.correctOfTotal).toHaveText(`${p.expected.score} of ${N} correct`);
        await expect(session.start.startButton).toHaveCount(0);
      }
    );
    await steps.step(
      "participant.tryStart",
      () => session.start.gotoDirect(creds!.link),
      async () => {
        await expect(session.page).toHaveURL(`${creds!.link}/result`);
        await expect(session.result.percent).toHaveText(`${p.expected.percent}%`);
        await expect(session.start.startButton).toHaveCount(0);
      }
    );
  });

  test(E2E_10.testTitle, async ({ steps, admin }) => {
    await signInAsAdmin(steps, admin);
    await openQuizFromDashboard(steps, admin);
    const quiz = admin.quiz;

    await steps.step(
      "stats.open",
      () => quiz.openTab("Questions"),
      async () => {
        await expect(quiz.statsNote).toHaveText("Based on 3 submitted attempts. Unanswered questions count as incorrect.");
        await expect(quiz.lockedNotice).toBeVisible();
      }
    );
    await steps.step(
      "stats.check",
      () => quiz.questionItems.first().scrollIntoViewIfNeeded(),
      async () => {
        const items = await quiz.readQuestionItems();
        expect(items).toHaveLength(N);
        items.forEach((item, i) => {
          const q = QUESTIONS[i];
          expect(item.text, `Q${i + 1} text`).toBe(q.text);
          expect(item.correctPercent, `Q${i + 1} % answered correctly`).toBe(`${correctPercent(i)}%`);
          expect(item.options.map((o) => [o.text, o.picks]), `Q${i + 1} picks per option`).toEqual(q.options.map((o) => [o, pickText(optionPicks(i, o))]));
        });
      }
    );
  });

  test(E2E_11.testTitle, async ({ steps, admin }) => {
    await signInAsAdmin(steps, admin);
    await openQuizFromDashboard(steps, admin);
    let file!: Awaited<ReturnType<typeof admin.quiz.exportCsv>>;
    let rows: string[][] = [];

    await steps.step(
      "csv.download",
      async () => {
        file = await admin.quiz.exportCsv();
      },
      async () => {
        expect(file.filename).toBe(CSV_FILENAME);
        expect(file.content.charCodeAt(0), "starts with a UTF-8 BOM so Excel shows names correctly").toBe(0xfeff);
        expect(await file.download.failure()).toBeNull();
      }
    );
    await steps.step(
      "csv.content",
      async () => {
        rows = parseCsv(file.content.replace(/^﻿/, ""));
      },
      async () => {
        expect(rows[0]).toEqual(["Rank", "Name", "Email", "Score", "Out of", "Percent", "Time taken", "Submitted at", "Auto-submitted"]);
        const data = rows.slice(1).filter((r) => r.some(Boolean));
        expect(data).toHaveLength(3);
        data.forEach((r, i) => {
          const p = ranked[i];
          expect(r.slice(0, 6), `row ${i + 1}`).toEqual([String(p.expected.rank), p.name, p.email, String(p.expected.score), String(N), `${p.expected.percent}%`]);
          expect(r[6], `row ${i + 1} time taken`).toMatch(/^(\d+h \d+m|\d+m \d{2}s|\d+s)$/);
          expect(r[7], `row ${i + 1} submitted at`).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
          expect(r[8], `row ${i + 1} auto-submitted`).toBe("no");
        });
      }
    );
  });
});
