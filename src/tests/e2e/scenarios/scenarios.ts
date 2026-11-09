/**
 * THE SOURCE OF TRUTH for the E2E test cases.
 *
 * - Every Playwright test title must equal `scenario.testTitle`.
 * - Every step a spec runs must be listed here, and every step listed here must
 *   run, in order (enforced by the `steps` fixture).
 * - src/tests/e2e-test-scenarios.md is generated from this file after each run
 *   (or with `npm run test:e2e:doc`). Don't edit the Markdown by hand.
 */
import { ADMIN, APP_URL, MAILBOX_URL, MAIL_FROM } from "../support/env";
import { QUESTIONS, QUIZ, TYPE_LABEL, TYPE_HINT } from "../data/quiz";
import {
  PARTICIPANTS,
  Participant,
  answerState,
  questionNumbersWhere,
  correctPercent,
  optionPicks,
  averagePercent,
  topPercent,
} from "../data/participants";
import { defineScenario, StepTuple } from "./define";
import { API_SCENARIOS } from "./api-scenarios";

// ---------- Text helpers ----------
const code = (s: string) => `\`${s}\``;
const bold = (s: string) => `**${s}**`;
const andList = (items: string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const nums = (list: number[]) => (list.length ? list.join(", ") : "none");
const plural = (n: number, w: string) => `${n} ${n === 1 ? w : w + "s"}`;
const N = QUESTIONS.length;

// Step texts must be identical on every run (they are the Allure step names and
// the Markdown), so they show a placeholder; the specs assert the real title.
const QUIZ_TITLE = `${QUIZ.baseTitle} [date and time]`;
const CSV_FILENAME = "e2e-general-knowledge-[date-and-time]-results.csv";

const TITLE_NOTE = `${code(QUIZ.baseTitle)} followed by a space and the current date and time (e.g. ${code(QUIZ.baseTitle + " 2026-11-09 14:05:33")}), so the title is unique`;
const QUIZ_REF = `the quiz ${bold(QUIZ_TITLE)} created in E2E-02`;

// ---------- Reusable steps ----------
const adminSignIn: StepTuple[] = [
  [
    "admin.openLogin",
    `Open a web browser and go to the admin sign-in page: ${code(APP_URL + "/admin/login")} (or your own Quiz Portal address followed by /admin/login).`,
    `The page shows the heading ${bold("Admin sign in")}, an ${bold("Email")} box, a ${bold("Password")} box and a ${bold("Sign in")} button.`,
  ],
  [
    "admin.signIn",
    `Click in ${bold("Email")} and type ${code(ADMIN.email)}. Click in ${bold("Password")} and type ${code(ADMIN.password)}. Click ${bold("Sign in")}.`,
    `The ${bold("Quizzes")} dashboard opens (address ends with ${code("/admin")}) and the name ${bold(ADMIN.name)} is shown in the top-right corner.`,
  ],
];

const openQuizFromDashboard: StepTuple = [
  "admin.openQuiz",
  `On the ${bold("Quizzes")} dashboard, click the card of ${QUIZ_REF}.`,
  `The quiz page opens with the quiz title as the heading, the ${bold("Active")} badge and the ${bold("Results")} tab selected.`,
];

// ---------- E2E-02 builder steps ----------
function builderQuestionStep(i: number): StepTuple {
  const q = QUESTIONS[i];
  const n = i + 1;
  const parts: string[] = [];
  if (i === 0) parts.push(`In the ${bold("Question 1")} card that is already on the page, click the ${bold(TYPE_LABEL[q.type])} type button at the top of the card.`);
  else parts.push(`Below the last question card, click the dashed ${bold(TYPE_LABEL[q.type])} button to add ${bold("Question " + n)}.`);
  parts.push(`Click in the ${bold("Type your question")} box of Question ${n} and type ${code(q.text)}.`);
  let expectedOptions: string;
  if (q.type === "yesno") {
    parts.push(`Click the ${bold(q.correct[0])} button to mark it as the correct answer.`);
    expectedOptions = `the ${bold("Yes")} and ${bold("No")} buttons, with only ${bold(q.correct[0])} highlighted as correct`;
  } else {
    const extra = q.options.length - 4;
    if (extra > 0) parts.push(`Click ${bold("+ Add option")} ${extra === 1 ? "once" : `${extra} times`} so there are ${q.options.length} option boxes.`);
    if (extra < 0) parts.push(`Click the ${bold("×")} button at the end of the last (empty) option box${extra < -1 ? ` ${-extra} times` : ""} so there are ${q.options.length} option boxes.`);
    parts.push(`Type the options into the option boxes from top to bottom: ${q.options.map(code).join(", ")}.`);
    const shape = q.type === "single" ? "round button" : "square box";
    parts.push(`Click the ${shape} to the left of ${andList(q.correct.map(bold))} to mark ${q.correct.length > 1 ? "them" : "it"} as correct.`);
    expectedOptions = `exactly these options in this order: ${q.options.map(bold).join(", ")}, with only ${andList(q.correct.map(bold))} marked correct (green tick)`;
  }
  return [
    `builder.question${n}`,
    parts.join(" "),
    `The Question ${n} card has ${bold(TYPE_LABEL[q.type])} selected, shows the question text ${bold(q.text)}, ${expectedOptions}. The counter next to the ${bold("Questions")} heading shows ${bold(String(n))}.`,
  ];
}

// ---------- Participant steps (E2E-04/05/06) ----------
function selectionPhrase(p: Participant, i: number) {
  const q = QUESTIONS[i];
  const picks = p.answers[i];
  if (!picks || !picks.length) return "do not select anything (leave this question unanswered).";
  return `${q.type === "multiple" ? "tick" : "click"} ${andList(picks.map(bold))}.`;
}

function takeQuestionStep(p: Participant, i: number): StepTuple {
  const q = QUESTIONS[i];
  const n = i + 1;
  const picks = p.answers[i] || [];
  const lead = i === 0 ? "" : `Click ${bold("Next")}. `;
  const last = n === N;
  return [
    `take.question${n}`,
    `${lead}On ${bold(`Question ${n} of ${N}`)} (“${q.text}”, ${TYPE_LABEL[q.type]}), ${selectionPhrase(p, i)} Write down the order in which the options are shown.`,
    `The page shows ${bold(`Question ${n} of ${N}`)}, the question ${bold(q.text)}, the hint ${bold(TYPE_HINT[q.type])} and exactly these options (the order can differ per person): ${q.options.map(bold).join(", ")}. ` +
      (picks.length ? `Only ${andList(picks.map(bold))} ${picks.length > 1 ? "are" : "is"} selected` : "Nothing is selected") +
      `, and box ${bold(String(n))} in the ${bold("Questions")} panel is ${picks.length ? "marked as answered" : "not marked as answered"}.` +
      (last ? ` The header shows ${bold(`${Object.keys(p.answers).length} of ${N} answered`)} and the save indicator says ${bold("All answers saved")}.` : ""),
  ];
}

function submitSummary(p: Participant) {
  const answered = Object.keys(p.answers).length;
  const unanswered = questionNumbersWhere(p, "unanswered");
  if (!unanswered.length) return `You've answered all ${N} questions. You can't change your answers after submitting.`;
  return `You've answered ${answered} of ${N} questions. ${unanswered.length} ${unanswered.length === 1 ? "question is" : "questions are"} still unanswered and will be marked incorrect. You can't change your answers after submitting.`;
}

function reviewExpectation(p: Participant, badge: "Your answer" | "Selected") {
  return (
    `The ${N} questions are listed in quiz order. Correct (green tick): ${bold(nums(questionNumbersWhere(p, "correct")))}. ` +
    `Incorrect (red cross): ${bold(nums(questionNumbersWhere(p, "incorrect")))}. Not answered (grey): ${bold(nums(questionNumbersWhere(p, "unanswered")))}. ` +
    `On every question the options appear in the same order ${p.name} saw during the quiz, ${bold(badge)} appears on exactly the options ${p.name} selected, ` +
    `and ${bold("Correct answer")} appears on each correct option they did not select.`
  );
}

function participantScenario(p: Participant, id: string) {
  const wrongOrMissing = N - p.expected.score;
  const unanswered = questionNumbersWhere(p, "unanswered");
  return defineScenario({
    id,
    title: `Participant ${p.name} receives the invitation email and completes the quiz (${p.expected.score}/${N})`,
    priority: "P1 - Critical",
    component: "Participant quiz flow (invitation email, sign-in, timer, autosave, submit, results)",
    preconditions: `E2E-03 has passed: ${p.name} (${p.email}) has been invited to ${QUIZ_REF}. The test mailbox (Mailpit) is open at ${MAILBOX_URL}.`,
    steps: [
      [
        "mail.openInbox",
        `Open the test mailbox at ${code(MAILBOX_URL)}. Click the ${bold("Search mailbox")} box at the top, type ${code(`to:${p.email}`)} and press Enter.`,
        `Exactly one email with the subject ${bold(`You're invited to take "${QUIZ_TITLE}"`)} is listed for ${bold(p.email)}.`,
      ],
      [
        "mail.openEmail",
        `Click that email to open it, then click the ${bold("Text")} tab to see the plain-text version, and the ${bold("HTML")} tab to go back.`,
        `The headers show From ${bold(`${MAIL_FROM.name} <${MAIL_FROM.address}>`)}, To ${bold(p.email)} and the subject above. The message says ${bold(`Hi ${p.name},`)}, ${bold(`${N} questions · ${QUIZ.durationMinutes} minutes`)}, shows the email ${bold(p.email)}, a 10-character password under ${bold("Your password")} and an ${bold("Open quiz")} button. The Text version contains the same link and the same password.`,
      ],
      [
        "mail.copyCredentials",
        `Write down the password shown under ${bold("Your password")}, and copy the link behind the ${bold("Open quiz")} button (right-click → Copy link address).`,
        `The link has the form ${code(APP_URL + "/q/<long code>")}. Both the link and the password are different from every other participant's invitation.`,
      ],
      [
        "participant.openLink",
        `Open a new private (incognito) browser window, paste the copied link into the address bar and press Enter.`,
        `The sign-in page shows the quiz title ${bold(QUIZ_TITLE)}, ${bold(`${N} questions`)}, ${bold(`${QUIZ.durationMinutes} minutes`)} and ${bold(`Signing in as ${p.email}`)}.`,
      ],
      [
        "participant.wrongPassword",
        `Click in ${bold("Password")}, type the wrong password ${code("WrongPass99")} and click ${bold("Continue")}.`,
        `A red message says ${bold("That password isn't right. Copy it exactly from your invitation email — it's case-sensitive.")} and you stay on the sign-in page.`,
      ],
      [
        "participant.signIn",
        `Clear the ${bold("Password")} box, type the password from the email exactly (it is case-sensitive) and click ${bold("Continue")}.`,
        `The instructions page opens. It greets ${bold(`Hi ${p.name} 👋`)}, shows the quiz title, lists ${bold(`${N} questions`)} and ${bold(`${QUIZ.durationMinutes} minutes`)}, and under ${bold("After you submit")} says ${bold("You'll see your score and can review the correct answers.")}`,
      ],
      [
        "participant.start",
        `Click ${bold("Start quiz")}. In the ${bold("Ready to begin?")} box, click ${bold("Start now")}.`,
        `The box said ${bold(`The ${QUIZ.durationMinutes}-minute timer will start immediately and can't be paused.`)} The quiz opens on ${bold(`Question 1 of ${N}`)}, the timer shows a time between ${bold(`${QUIZ.durationMinutes - 1}:00`)} and ${bold(`${QUIZ.durationMinutes}:00`)}, the header shows ${bold(`0 of ${N} answered`)}, and the page's data contains no information about which answers are correct.`,
      ],
      ...QUESTIONS.map((_, i) => takeQuestionStep(p, i)),
      [
        "take.review",
        `Click ${bold("Review & submit")} (the button that replaced ${bold("Next")} on the last question).`,
        `A box titled ${bold("Submit your answers?")} says ${bold(submitSummary(p))}` + (unanswered.length ? ` It lists a ${bold(`Question ${unanswered.join(", Question ")}`)} button for the unanswered question.` : ""),
      ],
      [
        "take.submit",
        `Click ${bold("Submit now")}.`,
        `The results page opens with the badge ${bold("Submitted")}, the score ${bold(p.expected.percent + "%")}, ${bold(`${p.expected.score} of ${N} correct`)}, the heading ${bold(p.expected.headline)}, and the chips ${bold(`${p.expected.score} correct`)} and ${bold(`${wrongOrMissing} incorrect or unanswered`)}.`,
      ],
      ["result.review", `Scroll down to ${bold("Review your answers")} and read each question.`, reviewExpectation(p, "Your answer")],
    ],
  });
}

// ---------- Scenarios ----------
export const E2E_01 = defineScenario({
  id: "E2E-01",
  title: "Admin signs in (wrong password rejected, correct password accepted)",
  priority: "P1 - Critical",
  component: "Admin authentication",
  preconditions: `Quiz Portal is running with a fresh database and the admin account ${ADMIN.email} / ${ADMIN.password} (created from ADMIN_EMAIL / ADMIN_PASSWORD).`,
  steps: [
    adminSignIn[0],
    [
      "admin.wrongPassword",
      `Click in ${bold("Email")} and type ${code(ADMIN.email)}. Click in ${bold("Password")} and type the wrong password ${code("not-the-password")}. Click ${bold("Sign in")}.`,
      `A red message says ${bold("That email and password don't match. Check them and try again.")} You stay on the sign-in page and the ${bold("Email")} box still contains ${bold(ADMIN.email)}.`,
    ],
    [
      "admin.signIn",
      `Click in ${bold("Password")}, type the correct password ${code(ADMIN.password)} and click ${bold("Sign in")}.`,
      `The ${bold("Quizzes")} dashboard opens (address ends with ${code("/admin")}), showing the ${bold("New quiz")} button and the name ${bold(ADMIN.name)} in the top-right corner.`,
    ],
    [
      "admin.accountMenu",
      `Click your name ${bold(ADMIN.name)} in the top-right corner.`,
      `A menu opens showing ${bold("Signed in as")} ${bold(ADMIN.email)}, ${bold("Account & password")} and ${bold("Sign out")}.`,
    ],
  ],
});

export const E2E_02 = defineScenario({
  id: "E2E-02",
  title: "Admin creates a 10-question quiz using all three question types",
  priority: "P1 - Critical",
  component: "Quiz builder",
  preconditions: "E2E-01 has passed (the admin can sign in).",
  steps: [
    ...adminSignIn,
    [
      "builder.open",
      `On the ${bold("Quizzes")} dashboard, click ${bold("New quiz")} (top right).`,
      `The ${bold("Create a quiz")} page opens (address ends with ${code("/admin/quizzes/new")}) with one empty ${bold("Single choice")} question card and the ${bold("Create quiz")} button in the bottom bar.`,
    ],
    [
      "builder.details",
      `In ${bold("Quiz details")}: click ${bold("Title")} and type ${TITLE_NOTE}. Click ${bold("Description")} and type ${code(QUIZ.description)}. Select everything in ${bold("Time limit")} and type ${code(String(QUIZ.durationMinutes))}.`,
      `The three boxes contain exactly what you typed, and the bottom bar says ${bold("Unsaved changes")}.`,
    ],
    [
      "builder.settings",
      `Leave ${bold("Shuffle answer options")} switched on. Under ${bold("After submitting, participants see")}, click ${bold("Score and correct answers")}.`,
      `The shuffle switch is on, and only the ${bold("Score and correct answers")} card is selected.`,
    ],
    ...QUESTIONS.map((_, i) => builderQuestionStep(i)),
    [
      "builder.save",
      `Click ${bold("Create quiz")} in the bottom bar.`,
      `The quiz page opens on the ${bold("Participants")} tab with the green message ${bold("Quiz created. Invite participants whenever you're ready.")} The header shows the title, ${bold("Active")}, ${bold(`${N} questions`)}, ${bold(`${QUIZ.durationMinutes} minutes`)}, ${bold("Options shuffled per participant")} and ${bold("Participants see their score and the correct answers")}.`,
    ],
    [
      "quiz.questionsTab",
      `Click the ${bold("Questions")} tab.`,
      `${N} questions are listed in the order you entered them, each with its type underneath (3 × Yes / No, 3 × Single choice, 4 × Multiple answers), every option you typed, and a green ${bold("Correct")} badge on exactly the correct options. There are no statistics yet.`,
    ],
    [
      "dashboard.card",
      `Click ${bold("All quizzes")} at the top left.`,
      `The dashboard has a card for the new quiz showing ${bold("Active")}, ${bold(`${N} questions`)}, ${bold(`${QUIZ.durationMinutes} min`)} and ${bold("No one invited yet")}.`,
    ],
  ],
});

export const E2E_03 = defineScenario({
  id: "E2E-03",
  title: "Admin invites three participants by email and each receives an invitation",
  priority: "P1 - Critical",
  component: "Invitations & email delivery",
  preconditions: "E2E-02 has passed. Automatic email is set up (in the automated run, SMTP points at the Mailpit test mailbox).",
  steps: [
    ...adminSignIn,
    [
      "admin.openQuiz",
      `On the ${bold("Quizzes")} dashboard, click the card of ${QUIZ_REF}.`,
      `The quiz page opens on the ${bold("Results")} tab showing ${bold("No results yet")}, and the counters show Invited ${bold("0")}, Started ${bold("0")}, Completed ${bold("0")}.`,
    ],
    [
      "invite.openTab",
      `Click the ${bold("Participants")} tab.`,
      `The ${bold("Invite people")} form is shown with an empty ${bold("Email addresses")} box and a greyed-out ${bold("Send invitations")} button. The ${bold("Participants")} list says ${bold("No one invited yet")}.`,
    ],
    [
      "invite.type",
      `Click in ${bold("Email addresses")} and type these three lines (press Enter after each of the first two): ${PARTICIPANTS.map((p) => code(`${p.name} <${p.email}>`)).join(", ")}.`,
      `Three blue chips appear below the box (${PARTICIPANTS.map((p) => bold(`${p.name} · ${p.email}`)).join(", ")}) and the button now reads ${bold("Send 3 invitations")}.`,
    ],
    [
      "invite.send",
      `Click ${bold("Send 3 invitations")}.`,
      `The green message ${bold("Invitation sent to 3 people.")} appears. The ${bold("Participants")} list shows ${andList(PARTICIPANTS.map((p) => bold(p.name)))}, each with status ${bold("Not started")} and an ${bold("Emailed")} note, and the counters show Invited ${bold("3")}, Started ${bold("0")}, Completed ${bold("0")}.`,
    ],
    [
      "mail.inboxHasThree",
      `Open the test mailbox at ${code(MAILBOX_URL)}. Click ${bold("Search mailbox")}, type ${code(`subject:"${QUIZ_TITLE}"`)} (with the quotes) and press Enter.`,
      `Exactly three emails are listed, all from ${bold(MAIL_FROM.name)} with the subject ${bold(`You're invited to take "${QUIZ_TITLE}"`)}: one each to ${andList(PARTICIPANTS.map((p) => bold(p.email)))}.`,
    ],
  ],
});

export const E2E_04 = participantScenario(PARTICIPANTS[0], "E2E-04");
export const E2E_05 = participantScenario(PARTICIPANTS[1], "E2E-05");
export const E2E_06 = participantScenario(PARTICIPANTS[2], "E2E-06");

export const E2E_07 = defineScenario({
  id: "E2E-07",
  title: "Admin sees the participants ranked 1, 2, 3 by score",
  priority: "P1 - Critical",
  component: "Results & ranking",
  preconditions: "E2E-04, E2E-05 and E2E-06 have passed (all three participants submitted).",
  steps: [
    ...adminSignIn,
    [
      "dashboard.cardCompleted",
      `On the ${bold("Quizzes")} dashboard, find the card of ${QUIZ_REF}.`,
      `The card shows ${bold("Active")}, ${bold(`Avg ${averagePercent}%`)} and ${bold("3/3 completed")}.`,
    ],
    [
      "admin.openQuiz",
      "Click that card.",
      `The quiz page opens on the ${bold("Results")} tab. The counters show Invited ${bold("3")}, Started ${bold("3")}, Completed ${bold("3")}, Average score ${bold(averagePercent + "%")} and Top score ${bold(topPercent + "%")}.`,
    ],
    [
      "results.ranking",
      "Read the ranking table from top to bottom.",
      `There are exactly three rows, in this order: ${[...PARTICIPANTS]
        .sort((a, b) => a.expected.rank - b.expected.rank)
        .map((p) => `rank ${bold(String(p.expected.rank))} ${bold(p.name)} (${p.email}) ${bold(p.expected.percent + "%")} ${bold(`${p.expected.score}/${N}`)}`)
        .join("; ")}. No row has an ${bold("Auto-submitted")} badge, and each row has a ${bold("View answers")} button.`,
    ],
    [
      "results.search",
      `Click ${bold("Search by name or email")} and type ${code("daniel")}.`,
      `Only ${bold("Daniel Silva")}'s row is visible, still with rank ${bold("2")}.`,
    ],
    [
      "results.clearSearch",
      `Delete the text in ${bold("Search by name or email")}.`,
      "All three rows are visible again in the same order (1, 2, 3).",
    ],
    [
      "results.participantsTab",
      `Click the ${bold("Participants")} tab.`,
      `${PARTICIPANTS.map((p) => `${bold(p.name)} shows ${bold(`Completed · ${p.expected.percent}%`)}`).join(", ")}. The header says ${bold("3 invited · 3 completed")}.`,
    ],
  ],
});

const attemptSteps: StepTuple[] = [...PARTICIPANTS]
  .sort((a, b) => a.expected.rank - b.expected.rank)
  .flatMap((p): StepTuple[] => {
    const wrong = [...questionNumbersWhere(p, "incorrect"), ...questionNumbersWhere(p, "unanswered")].sort((a, b) => a - b);
    return [
      [
        `attempt.${p.id}.open`,
        `In the ranking table, click ${bold("View answers")} on ${bold(p.name)}'s row (rank ${p.expected.rank}).`,
        `The answers page shows ${bold(p.name)}, ${bold(p.email)}, rank ${bold("#" + p.expected.rank)} ${bold("of 3")}, Score ${bold(p.expected.percent + "%")} and Correct ${bold(`${p.expected.score} / ${N}`)}.`,
      ],
      [`attempt.${p.id}.answers`, `Scroll through ${bold("Answers")} and read each of the ${N} questions.`, reviewExpectation(p, "Selected")],
      [
        `attempt.${p.id}.filter`,
        `Click the ${bold("Incorrect")} filter button above the answers.`,
        wrong.length
          ? `Only ${plural(wrong.length, "question")} remain${wrong.length === 1 ? "s" : ""} visible: question${wrong.length === 1 ? "" : "s"} ${bold(wrong.join(", "))}.`
          : `No questions remain visible (${p.name} answered everything correctly).`,
      ],
      [
        `attempt.${p.id}.back`,
        `Click the ${bold(`← … · Results`)} link at the top of the page.`,
        `The quiz page is shown again on the ${bold("Results")} tab with all three rows.`,
      ],
    ];
  });

export const E2E_08 = defineScenario({
  id: "E2E-08",
  title: "Admin reviews each participant's answers exactly as they were selected",
  priority: "P1 - Critical",
  component: "Admin answer review",
  preconditions: "E2E-04, E2E-05 and E2E-06 have passed. You know the option order each participant saw (written down during E2E-04 to E2E-06).",
  steps: [...adminSignIn, openQuizFromDashboard, ...attemptSteps],
});

const amaya = PARTICIPANTS[0];
export const E2E_09 = defineScenario({
  id: "E2E-09",
  title: "A participant who already submitted cannot take the quiz again",
  priority: "P2 - High",
  component: "Participant access control",
  preconditions: `E2E-04 has passed. You have ${amaya.name}'s invitation link and password from her email.`,
  steps: [
    [
      "participant.reopenLink",
      `Open a new private (incognito) browser window and go to ${amaya.name}'s invitation link.`,
      `The sign-in page shows the green message ${bold("You've already completed this quiz. Sign in to see your results.")}`,
    ],
    [
      "participant.signInAgain",
      `Type ${amaya.name}'s password and click ${bold("Continue")}.`,
      `The results page opens straight away (no instructions page, no ${bold("Start quiz")} button), showing ${bold(amaya.expected.percent + "%")} and ${bold(`${amaya.expected.score} of ${N} correct`)}.`,
    ],
    [
      "participant.tryStart",
      `In the address bar, add ${code("/start")} to the end of the invitation link and press Enter.`,
      "You are sent back to the results page with the same score. The quiz cannot be started again.",
    ],
  ],
});

const statsLines = QUESTIONS.map((q, i) => `Q${i + 1} ${bold(correctPercent(i) + "%")} (${q.options.map((o) => `${o}: ${plural(optionPicks(i, o), "pick")}`).join(", ")})`);
export const E2E_10 = defineScenario({
  id: "E2E-10",
  title: "Question statistics reflect the three submitted attempts",
  priority: "P2 - High",
  component: "Question statistics",
  preconditions: "E2E-04, E2E-05 and E2E-06 have passed.",
  steps: [
    ...adminSignIn,
    openQuizFromDashboard,
    [
      "stats.open",
      `Click the ${bold("Questions")} tab.`,
      `Above the list it says ${bold("Based on 3 submitted attempts. Unanswered questions count as incorrect.")}, and the locked-questions notice is shown.`,
    ],
    [
      "stats.check",
      `For each question, read the percentage under ${bold("answered correctly")} on the right and the ${bold("picks")} count next to each option.`,
      `The values are: ${statsLines.join("; ")}.`,
    ],
  ],
});

export const E2E_11 = defineScenario({
  id: "E2E-11",
  title: "Admin exports the ranked results as CSV",
  priority: "P2 - High",
  component: "Results export (CSV)",
  preconditions: "E2E-04, E2E-05 and E2E-06 have passed.",
  steps: [
    ...adminSignIn,
    openQuizFromDashboard,
    [
      "csv.download",
      `On the ${bold("Results")} tab, click ${bold("Export CSV")}.`,
      `A file named ${bold(CSV_FILENAME)} (the quiz title in lower case with dashes, followed by -results.csv) is downloaded.`,
    ],
    [
      "csv.content",
      "Open the downloaded file in a spreadsheet app or a text editor.",
      `The first row is ${bold("Rank, Name, Email, Score, Out of, Percent, Time taken, Submitted at, Auto-submitted")}, followed by exactly three rows: ${[...PARTICIPANTS]
        .sort((a, b) => a.expected.rank - b.expected.rank)
        .map((p) => bold(`${p.expected.rank}, ${p.name}, ${p.email}, ${p.expected.score}, ${N}, ${p.expected.percent}%`))
        .join("; ")}. Each row has a time taken, a ${bold("Submitted at")} value like ${bold("2026-11-09 14:05")} and ${bold("no")} under Auto-submitted.`,
    ],
  ],
});

export const UI_SCENARIOS = [E2E_01, E2E_02, E2E_03, E2E_04, E2E_05, E2E_06, E2E_07, E2E_08, E2E_09, E2E_10, E2E_11];
export { API_SCENARIOS };
/** Every documented test case: browser end-to-end (E2E-…) and API (API-…). */
export const SCENARIOS = [...UI_SCENARIOS, ...API_SCENARIOS];

export const scenarioByTitle = (title: string) => SCENARIOS.find((s) => s.testTitle === title);
export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id);

// Exposed for specs that need per-question expectations.
export { answerState };
