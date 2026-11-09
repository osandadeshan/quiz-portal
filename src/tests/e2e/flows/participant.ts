import { expect } from "@playwright/test";
import type { ParticipantApp } from "../fixtures/test";
import type { ReviewItem } from "../pages/components/AnswerReview";
import { ScenarioSteps } from "../support/steps";
import { APP_URL, MAIL_FROM } from "../support/env";
import { QUESTIONS, QUIZ, QUIZ_TITLE, TYPE_HINT } from "../data/quiz";
import { Participant, answerState, questionNumbersWhere } from "../data/participants";
import { run } from "../support/run-state";
import { escape } from "./admin";

const N = QUESTIONS.length;
/** Participant passwords: 10 characters, no look-alikes (src/util.js PASSWORD_ALPHABET). */
const PASSWORD_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789]{10}$/;
/** Invitation tokens: 24 random bytes, base64url → 32 characters. */
const LINK_RE = new RegExp(`^${escape(APP_URL)}/q/[A-Za-z0-9_-]{32}$`);
const REVIEW_TYPE_LABEL = { single: "Single choice", yesno: "Yes / No", multiple: "Multiple answers — all correct options required" };

/** Deep-scan the quiz JSON sent to the browser for anything revealing the correct answers. */
function leakedCorrectness(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => leakedCorrectness(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      /correct|is_correct|answer_key|solution/i.test(k) ? [`${path}.${k}`] : leakedCorrectness(v, `${path}.${k}`)
    );
  }
  return [];
}

/**
 * Assert the answer review (participant result page or admin attempt page) shows
 * exactly what `p` selected, in the order they saw, with the right markers.
 */
export function expectReviewMatches(items: ReviewItem[], p: Participant, pickedBadge: "Your answer" | "Selected") {
  const order = run.optionOrder.get(p.id);
  expect(order, `option order recorded for ${p.name} during the quiz`).toHaveLength(N);
  expect(items, "one review entry per question").toHaveLength(N);
  items.forEach((item, i) => {
    const q = QUESTIONS[i];
    const picks = p.answers[i] || [];
    const state = answerState(p, i);
    const where = `${p.name}, question ${i + 1}`;
    expect(item.number, `${where}: number`).toBe(i + 1);
    expect(item.text, `${where}: text`).toBe(q.text);
    expect(item.state, `${where}: correct / incorrect / not answered icon`).toBe(state);
    expect(item.typeLabel, `${where}: type label`).toBe(REVIEW_TYPE_LABEL[q.type] + (state === "unanswered" ? " · Not answered" : ""));
    expect(item.options.map((o) => o.text), `${where}: options in the order the participant saw`).toEqual(order![i]);
    for (const o of item.options) {
      const picked = picks.includes(o.text);
      const correct = q.correct.includes(o.text);
      const expectedBadges = picked ? [pickedBadge] : correct ? ["Correct answer"] : [];
      expect(o.picked, `${where}, option "${o.text}": selection marker`).toBe(picked);
      expect(o.badges, `${where}, option "${o.text}": badges`).toEqual(expectedBadges);
      expect(o.highlightedCorrect, `${where}, option "${o.text}": green highlight on correct options`).toBe(correct);
    }
  });
}

/** E2E-04/05/06: read the invitation in the mailbox, sign in, take the quiz, check the result. */
export async function completeQuizFromEmail(steps: ScenarioSteps, p: Participant, session: ParticipantApp) {
  steps.use(session.page);
  let email!: Awaited<ReturnType<typeof session.mailbox.readInvitation>>;
  const subject = `You're invited to take "${QUIZ_TITLE}"`;

  await steps.step(
    "mail.openInbox",
    async () => {
      await session.mailbox.goto();
      await session.mailbox.search(`to:${p.email}`);
    },
    async () => {
      await expect(session.mailbox.messageRows).toHaveCount(1);
      expect(await session.mailbox.listedRecipients()).toEqual([p.email]);
      expect(await session.mailbox.listedSubjects()).toEqual([subject]);
    }
  );

  await steps.step(
    "mail.openEmail",
    async () => {
      await session.mailbox.openMessage(0);
      email = await session.mailbox.readInvitation();
    },
    async () => {
      expect(email.from).toBe(`${MAIL_FROM.name} <${MAIL_FROM.address}>`);
      expect(email.to).toBe(`<${p.email}>`);
      expect(email.subject).toBe(subject);
      expect(email.greeting).toBe(`Hi ${p.name},`);
      expect(email.heading).toBe(`You're invited to take “${QUIZ_TITLE}”`);
      expect(email.summary).toBe(`${N} questions · ${QUIZ.durationMinutes} minutes`);
      expect(email.shownEmail).toBe(p.email);
      expect(email.password).toMatch(PASSWORD_RE);
      expect(email.link).toMatch(LINK_RE);
      expect(email.plainText).toContain(`Hi ${p.name},`);
      expect(email.plainText).toContain(`You have been invited to take the quiz "${QUIZ_TITLE}".`);
      expect(email.plainText).toContain(`${N} questions · ${QUIZ.durationMinutes} minutes`);
      expect(email.plainText).toContain(`1. Open your personal link: ${email.link}`);
      expect(email.plainText).toContain(`2. Sign in with this password: ${email.password}`);
    }
  );

  await steps.step(
    "mail.copyCredentials",
    async () => {
      run.credentials.set(p.id, { link: email.link, password: email.password });
    },
    async () => {
      expect(email.link).toMatch(LINK_RE);
      expect(email.fallbackLink, "the 'paste this link' fallback is the same link").toBe(email.link);
      for (const [other, c] of run.credentials) {
        if (other === p.id) continue;
        expect(email.link, `link differs from ${other}'s`).not.toBe(c.link);
        expect(email.password, `password differs from ${other}'s`).not.toBe(c.password);
      }
    }
  );

  const link = () => run.credentials.get(p.id)!.link;

  await steps.step(
    "participant.openLink",
    () => session.login.open(link()),
    async () => {
      await expect(session.page).toHaveURL(link());
      await expect(session.login.quizTitle).toHaveText(QUIZ_TITLE);
      expect(await session.login.chipTexts()).toEqual([`${N} questions`, `${QUIZ.durationMinutes} minutes`]);
      await expect(session.login.signingInAs).toHaveText(p.email);
      await expect(session.login.passwordInput).toHaveValue("");
      await expect(session.login.error).toHaveCount(0);
      await expect(session.login.completedNotice).toHaveCount(0);
    }
  );

  await steps.step(
    "participant.wrongPassword",
    () => session.login.signIn("WrongPass99"),
    async () => {
      await expect(session.login.error).toHaveText("That password isn't right. Copy it exactly from your invitation email — it's case-sensitive.");
      await expect(session.page).toHaveURL(link());
      await expect(session.login.passwordInput).toBeVisible();
    }
  );

  await steps.step(
    "participant.signIn",
    () => session.login.signIn(email.password),
    async () => {
      await expect(session.page).toHaveURL(`${link()}/start`);
      await expect(session.start.greeting).toHaveText(`Hi ${p.name} 👋`);
      await expect(session.start.quizTitle).toHaveText(QUIZ_TITLE);
      expect(await session.start.ruleTitleTexts()).toEqual([
        `${N} questions`,
        `${QUIZ.durationMinutes} minutes`,
        "Answers save automatically",
        "Automatic submission",
        "After you submit",
      ]);
      await expect(session.start.ruleText("After you submit")).toHaveText("You'll see your score and can review the correct answers.");
      await expect(session.start.startButton).toBeEnabled();
    }
  );

  const dialog = { title: "", text: "", button: "" };
  await steps.step(
    "participant.start",
    async () => {
      await session.start.startButton.click();
      await expect(session.start.confirm.root).toBeVisible();
      dialog.title = await session.start.confirm.title.innerText();
      dialog.text = await session.start.confirm.text.innerText();
      dialog.button = await session.start.confirm.confirmButton.innerText();
      await session.start.confirm.confirmButton.click();
    },
    async () => {
      expect(dialog).toEqual({
        title: "Ready to begin?",
        text: `The ${QUIZ.durationMinutes}-minute timer will start immediately and can't be paused.`,
        button: "Start now",
      });
      await expect(session.page).toHaveURL(`${link()}/take`);
      await expect(session.take.counter).toHaveText(`Question 1 of ${N}`);
      await expect(session.take.answeredLabel).toHaveText(`0 of ${N} answered`);
      const seconds = await session.take.timerSeconds();
      expect(seconds, "timer shows the full duration counting down").toBeLessThanOrEqual(QUIZ.durationMinutes * 60);
      expect(seconds).toBeGreaterThan((QUIZ.durationMinutes - 1) * 60);
      const data = JSON.parse(await session.take.embeddedQuizData());
      expect(leakedCorrectness(data), "no correct-answer information is sent to the browser").toEqual([]);
      expect(data.questions.map((q: { text: string }) => q.text)).toEqual(QUESTIONS.map((q) => q.text));
      for (const q of data.questions) for (const o of q.options) expect(Object.keys(o).sort()).toEqual(["id", "text"]);
    }
  );

  const order: string[][] = [];
  run.optionOrder.set(p.id, order);
  const answeredTotal = Object.keys(p.answers).length;

  for (let i = 0; i < N; i++) {
    const q = QUESTIONS[i];
    const n = i + 1;
    const picks = p.answers[i] || [];
    await steps.step(
      `take.question${n}`,
      async () => {
        if (i > 0) await session.take.next();
        await expect(session.take.counter).toHaveText(`Question ${n} of ${N}`);
        await session.take.select(picks);
      },
      async () => {
        await expect(session.take.questionText).toHaveText(q.text);
        await expect(session.take.hint).toHaveText(TYPE_HINT[q.type]);
        const choices = await session.take.readChoices();
        order[i] = choices.map((c) => c.text);
        expect([...order[i]].sort(), "exactly the options the admin entered").toEqual([...q.options].sort());
        if (q.type === "yesno") expect(order[i], "Yes / No is never shuffled").toEqual(["Yes", "No"]);
        const inputType = q.type === "multiple" ? "checkbox" : "radio";
        expect(choices.map((c) => c.inputType)).toEqual(choices.map(() => inputType));
        expect(choices.filter((c) => c.checked).map((c) => c.text).sort(), "only the intended options are selected").toEqual([...picks].sort());
        await expect(session.take.navButton(n)).toHaveClass(/\bcurrent\b/);
        if (picks.length) await expect(session.take.navButton(n)).toHaveClass(/\banswered\b/);
        else await expect(session.take.navButton(n)).not.toHaveClass(/\banswered\b/);
        if (n === N) {
          await expect(session.take.answeredLabel).toHaveText(`${answeredTotal} of ${N} answered`);
          await expect(session.take.saveState).toHaveText("All answers saved");
          await expect(session.take.nextButton).toHaveText("Review & submit");
        }
      }
    );
  }

  const unanswered = questionNumbersWhere(p, "unanswered");
  await steps.step(
    "take.review",
    () => session.take.openSubmitDialog(),
    async () => {
      await expect(session.take.submitDialog).toBeVisible();
      await expect(session.take.submitDialogTitle).toHaveText("Submit your answers?");
      const summary = unanswered.length
        ? `You've answered ${answeredTotal} of ${N} questions. ${unanswered.length} ${unanswered.length === 1 ? "question is" : "questions are"} still unanswered and will be marked incorrect. You can't change your answers after submitting.`
        : `You've answered all ${N} questions. You can't change your answers after submitting.`;
      await expect(session.take.submitSummary).toHaveText(summary);
      await expect(session.take.unansweredButtons).toHaveText(unanswered.map((u) => `Question ${u}`));
    }
  );

  await steps.step(
    "take.submit",
    () => session.take.submitNow(),
    async () => {
      await expect(session.page).toHaveURL(`${link()}/result`);
      await expect(session.result.submittedBadge).toHaveText("Submitted");
      await expect(session.result.percent).toHaveText(`${p.expected.percent}%`);
      await expect(session.result.correctOfTotal).toHaveText(`${p.expected.score} of ${N} correct`);
      await expect(session.result.headline).toHaveText(p.expected.headline);
      const chips = await session.result.chipTexts();
      expect(chips).toHaveLength(3);
      expect(chips[0]).toMatch(/^Time taken: (\d+m \d{2}s|\d+s)$/);
      expect(chips.slice(1)).toEqual([`${p.expected.score} correct`, `${N - p.expected.score} incorrect or unanswered`]);
    }
  );

  await steps.step(
    "result.review",
    () => session.result.reviewHeading.scrollIntoViewIfNeeded(),
    async () => {
      await expect(session.result.reviewHeading).toBeVisible();
      expectReviewMatches(await session.result.review.read(), p, "Your answer");
    }
  );
}
