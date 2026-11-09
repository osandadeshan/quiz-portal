/**
 * API test cases (API-01 …). These were the curl smoke test; now they're
 * Playwright API tests with the same documentation, Allure steps and cleanup as
 * the UI tests. Each step's evidence in Allure is the HTTP requests and
 * responses it made.
 *
 * Text uses `[date and time]` for the run-specific part of quiz titles.
 */
import { ADMIN } from "../support/env";
import { Q, docTitle, API_PASSWORDS } from "../data/api";
import { defineScenario } from "./define";

const HOW =
  "The E2E stack is running (see **How to run**). Use an HTTP client that keeps cookies and does **not** follow redirects (for example `curl -c jar.txt -b jar.txt`, or Postman with redirects off). " +
  "For every POST, send the CSRF token from the `<meta name=\"csrf-token\">` tag of the last page you loaded: as the `_csrf` form field, or as the `X-CSRF-Token` header for JSON.";

const SIGN_IN = `Sign in as the admin: \`GET /admin/login\`, then \`POST /admin/login\` with \`email=${ADMIN.email}\` and \`password=${ADMIN.password}\`.`;
const SIGNED_IN = "HTTP **302** to `/admin`.";

const QUIZ_SHAPE =
  `three questions: single choice “${Q.single.text}” (${Q.single.options.join(", ")}; correct **${Q.single.correct}**), ` +
  `Yes/No “${Q.yesno.text}” (correct **${Q.yesno.correct}**), and multiple answers “${Q.multiple.text}” (${Q.multiple.options.join(", ")}; correct **${Q.multiple.correct.join(" + ")}**), 5 minutes`;

const createQuiz = (title: string, extra = "") =>
  `${SIGN_IN} Then send \`POST /admin/quizzes\` (JSON) for a quiz titled \`${docTitle(title)}\` with ${QUIZ_SHAPE}${extra}, and \`GET\` the \`redirect\` it returns.`;
const CREATED =
  "Sign-in returns HTTP 302 to `/admin`; the quiz request returns HTTP **200** with `{\"redirect\":\"/admin/quizzes/<id>?tab=participants\"}`; that page shows the quiz title and “Quiz created. Invite participants whenever you're ready.”.";

const inviteOne = (email: string) =>
  `Send \`POST /admin/quizzes/<id>/invite\` with \`recipients=${email}\`, then open the inbox (\`GET http://127.0.0.1:18025/api/v1/search?query=to:"${email}"\`) and read the email's link (\`/q/<token>\`) and password.`;
const INVITED = "The invite returns HTTP 302; exactly one invitation email arrives, with a `/q/<token>` link and a 10-character password.";

const startAs = "In a **separate** cookie jar (the participant), `GET /q/<token>`, `POST /q/<token>` with the password, then `POST /q/<token>/start`.";
const STARTED = "Sign-in returns HTTP 302 to `/q/<token>`, Start returns HTTP 302 to `/q/<token>/take`, and `GET /q/<token>/take` returns HTTP 200.";

export const API_01 = defineScenario({
  id: "API-01",
  title: "Health check reports the app is up, and first-run setup is locked once an admin exists",
  priority: "P1 - Critical",
  component: "API · Health check, first-run setup",
  preconditions: `${HOW} An admin account already exists (the E2E admin).`,
  steps: [
    ["health", "Send `GET /healthz`.", "HTTP **200**, header `Cache-Control: no-store`, JSON body exactly `{\"ok\":true}`."],
    ["setupPage", "Without signing in, send `GET /admin/setup`.", "HTTP **302** to `/admin/login`: setup is only for the very first admin, and one already exists."],
    [
      "setupPost",
      `Send \`GET /admin/login\` (for a CSRF token), then \`POST /admin/setup\` with \`name=Intruder\`, \`email=api01.intruder@example.com\`, \`password\` and \`confirm\` both \`${API_PASSWORDS.intruder}\`.`,
      "HTTP **302** to `/admin/login`, and no admin with the email `api01.intruder@example.com` exists (0 rows in the `admins` table).",
    ],
  ],
});

export const API_02 = defineScenario({
  id: "API-02",
  title: "Admin pages and actions require signing in",
  priority: "P1 - Critical",
  component: "API · Admin authentication",
  preconditions: HOW,
  steps: [
    ["dashboard", "Without signing in, send `GET /admin`.", "HTTP **302** to `/admin/login`."],
    [
      "json",
      `Send \`GET /admin/login\` (for a CSRF token), then, still signed out, \`POST /admin/quizzes\` (JSON) for a quiz titled \`${docTitle("API-02 Signed-out quiz")}\`.`,
      "HTTP **401** with JSON `{\"error\":\"Please sign in again.\"}`, and no quiz with that title exists.",
    ],
    [
      "wrongPassword",
      `Send \`POST /admin/login\` with \`email=${ADMIN.email}\` and \`password=not-the-password\`.`,
      "HTTP **401**; the page shows “That email and password don't match. Check them and try again.”, and `GET /admin` still returns 302 to `/admin/login`.",
    ],
    ["signIn", `Send \`POST /admin/login\` with \`email=${ADMIN.email}\` and \`password=${ADMIN.password}\`.`, "HTTP **302** to `/admin`; `GET /admin` now returns HTTP **200** with the heading “Quizzes”."],
    ["signOut", "Send `POST /admin/logout`.", "HTTP **302** to `/admin/login`, and `GET /admin` returns 302 to `/admin/login` again."],
  ],
});

export const API_03 = defineScenario({
  id: "API-03",
  title: "Requests without a valid CSRF token are refused",
  priority: "P1 - Critical",
  component: "API · CSRF protection",
  preconditions: HOW,
  steps: [
    ["signIn", SIGN_IN, SIGNED_IN],
    [
      "badHeader",
      `Send \`POST /admin/quizzes\` (JSON) for a valid quiz titled \`${docTitle("API-03 CSRF quiz")}\`, with the header \`X-CSRF-Token: nope\`.`,
      "HTTP **403** with JSON `{\"error\":\"Your session expired. Reload the page and try again.\"}`.",
    ],
    ["noHeader", "Send the same request with no `X-CSRF-Token` header at all.", "HTTP **403** with the same JSON error."],
    [
      "formNoToken",
      `Send \`POST /admin/team\` as a form (add admin \`name=CSRF Victim\`, \`email=api03.victim@example.com\`, \`password=${API_PASSWORDS.victim}\`) **without** the \`_csrf\` field.`,
      "HTTP **403**, and no admin with the email `api03.victim@example.com` exists.",
    ],
    ["nothingCreated", "Send `GET /admin` (the dashboard).", `HTTP **200**, and no quiz titled \`${docTitle("API-03 CSRF quiz")}\` is listed (0 such quizzes in the database).`],
  ],
});

export const API_04 = defineScenario({
  id: "API-04",
  title: "Quiz data is validated on the server",
  priority: "P1 - Critical",
  component: "API · Quiz builder validation",
  preconditions: HOW,
  steps: [
    ["signIn", SIGN_IN, SIGNED_IN],
    [
      "empty",
      "Send `POST /admin/quizzes` (JSON) with `{\"title\":\"\",\"durationMinutes\":0,\"questions\":[]}`.",
      "HTTP **422** with `errors`: title “Give your quiz a title.”, durationMinutes “Duration must be a whole number between 1 and 600 minutes.”, questions “Add at least one question.”.",
    ],
    [
      "malformed",
      "Send `POST /admin/quizzes` (JSON) with `{\"title\":\"x\",\"durationMinutes\":5,\"questions\":[null,{\"options\":[null,7]}]}`.",
      "HTTP **422** (not a 500 crash) with `errors.questionErrors` for both questions: “Write the question.”, “Add at least two answer options.”, “Mark the correct answer.”; `GET /healthz` still returns 200.",
    ],
    ["tooLong", "Send a valid quiz whose title is 201 characters long.", "HTTP **422** with `errors.title` “Keep the title under 200 characters.”."],
    [
      "valid",
      `Send \`POST /admin/quizzes\` (JSON) for a quiz titled \`${docTitle("API-04 Valid quiz")}\` with ${QUIZ_SHAPE}.`,
      "HTTP **200** with `{\"redirect\":\"/admin/quizzes/<id>?tab=participants\"}`; the database has that quiz with 3 questions (types single, yesno, multiple in that order), 8 options and 4 marked correct.",
    ],
    ["view", "Send `GET /admin/quizzes/<id>?tab=questions`.", `HTTP **200** with the heading \`${docTitle("API-04 Valid quiz")}\`.`],
  ],
});

const API05_RECIPIENTS = "Smith, John <api05.john@example.com>; Anna Lee <api05.anna@example.com>, api05.ben@example.com\nnot-an-email";
export const API_05 = defineScenario({
  id: "API-05",
  title: "Invitations accept Outlook-style address lists and email each person a unique link and password",
  priority: "P1 - Critical",
  component: "API · Invitations, email delivery",
  preconditions: HOW,
  steps: [
    ["setup", createQuiz("API-05 Invitations"), CREATED],
    [
      "invite",
      `Send \`POST /admin/quizzes/<id>/invite\` with \`recipients\` set to these two lines: \`${API05_RECIPIENTS.replace("\n", "` and `")}\`. Then \`GET\` the page it redirects to.`,
      "HTTP **302** to `/admin/quizzes/<id>?tab=participants`; that page shows “Invitation sent to 3 people.” and the warning “Ignored invalid entries: not-an-email.”.",
    ],
    [
      "list",
      "Read the participants list on that page.",
      "Exactly 3 people, all “Not started” and “Emailed …”: **Smith, John** (api05.john@example.com), **Anna Lee** (api05.anna@example.com) and **Api05 Ben** (api05.ben@example.com, name made from the email).",
    ],
    [
      "emails",
      "In the inbox API, search for each of the three addresses.",
      `Exactly one email each, subject \`You're invited to take "${docTitle("API-05 Invitations")}"\`, each with a \`/q/<token>\` link and a 10-character password; all three links and all three passwords are different.`,
    ],
    ["links", "Send `GET /q/<token>` for each of the three links (each in its own cookie jar).", `HTTP **200** each, with the heading \`${docTitle("API-05 Invitations")}\` and a password field.`],
  ],
});

export const API_06 = defineScenario({
  id: "API-06",
  title: "Participant sign-in works, and correct answers never reach the participant",
  priority: "P1 - Critical",
  component: "API · Participant sign-in, quiz player data",
  preconditions: HOW,
  steps: [
    ["setup", createQuiz("API-06 Sign-in"), CREATED],
    ["invite", inviteOne("api06.pat@example.com"), INVITED],
    [
      "wrongPassword",
      "As the participant (own cookie jar), `GET /q/<token>`, then `POST /q/<token>` with `password=wrong`.",
      "HTTP **401**; the page shows “That password isn't right. Copy it exactly from your invitation email — it's case-sensitive.” and still has the password field.",
    ],
    [
      "signIn",
      "Send `POST /q/<token>` with the password from the email, then `GET` the redirect.",
      "HTTP **302** to `/q/<token>`, which redirects (302) to `/q/<token>/start`; the start page returns HTTP 200.",
    ],
    ["start", "Send `POST /q/<token>/start`.", "HTTP **302** to `/q/<token>/take`."],
    [
      "payload",
      "Send `GET /q/<token>/take` and read the JSON inside `<script id=\"quiz-data\">`.",
      "HTTP **200**; 3 questions in the builder's order with the right types; every option has **only** `id` and `text`; Yes/No options are exactly Yes, No; the page contains neither `is_correct` nor `\"correct\"`; the deadline is 4–5 minutes after `serverNow`.",
    ],
  ],
});

export const API_07 = defineScenario({
  id: "API-07",
  title: "Signing in to a link on a second device signs out the first",
  priority: "P1 - Critical",
  component: "API · One browser per link",
  preconditions: HOW,
  steps: [
    ["setup", createQuiz("API-07 One browser"), CREATED],
    ["invite", inviteOne("api07.sam@example.com"), INVITED],
    ["first", `As **device 1**: ${startAs} Then send \`GET /q/<token>/ping\` with \`Accept: application/json\`.`, `${STARTED} Ping returns HTTP **200** with \`"ok":true\`.`],
    ["second", "As **device 2** (a new cookie jar): `GET /q/<token>`, then `POST /q/<token>` with the same password.", "HTTP **302** to `/q/<token>`."],
    [
      "firstOut",
      "As device 1, send `GET /q/<token>/ping` (`Accept: application/json`), then `GET /q/<token>/take`.",
      "Ping returns HTTP **401** with `{\"error\":\"This link was opened in another browser.\",\"redirect\":\"/q/<token>?elsewhere=1\"}`; the take page returns 302 to `/q/<token>?elsewhere=1`.",
    ],
    ["secondOk", "As device 2, send `GET /q/<token>/ping` and `GET /q/<token>/take`.", "Ping returns HTTP **200** with `\"ok\":true`; the take page returns HTTP 200."],
    ["adminSees", "As the admin, open `GET /admin/quizzes/<id>?tab=participants`.", "api07.sam@example.com shows “In progress” and “2 sign-ins” (the database's `sign_in_count` is 2)."],
  ],
});

export const API_08 = defineScenario({
  id: "API-08",
  title: "Answers autosave, and scoring is all-or-nothing per question",
  priority: "P1 - Critical",
  component: "API · Autosave, scoring, ranking",
  preconditions: HOW,
  steps: [
    ["setup", createQuiz("API-08 Scoring"), CREATED],
    ["invite", inviteOne("api08.kim@example.com"), INVITED],
    ["start", `As the participant: ${startAs}`, STARTED],
    [
      "autosave",
      `Send \`POST /q/<token>/answers\` (JSON) with: “${Q.single.text}” → **4**, “${Q.yesno.text}” → **Yes**, “${Q.multiple.text}” → only **2** (one of its two correct answers). Then \`GET /q/<token>/take\` again.`,
      "HTTP **200** with `\"ok\":true`; the reloaded quiz data has exactly those saved answers.",
    ],
    ["submit", "Send `POST /q/<token>/submit` (JSON) with the same answers.", "HTTP **200** with `{\"redirect\":\"/q/<token>/result\"}`."],
    [
      "result",
      "Send `GET /q/<token>/result`.",
      "HTTP **200**; the score is **67%**, “2 of 3 correct” (the multiple-answer question gets no credit for a partial pick); 3 answers are reviewed.",
    ],
    ["adminResults", "As the admin, open `GET /admin/quizzes/<id>?tab=results`.", "One row: rank **1** (gold badge), api08.kim@example.com, **67%**, **2/3**; the database score is 2 out of 3."],
    [
      "resubmit",
      "As the participant, send `POST /q/<token>/submit` again with every answer correct, then `POST /q/<token>/answers` with every answer correct.",
      "The repeated submit is safe to retry: HTTP **200** with `{\"redirect\":\"/q/<token>/result\"}`, but nothing is re-scored. The late autosave returns HTTP **409** with “This quiz has already been submitted.”. The score stays 2 out of 3.",
    ],
  ],
});

export const API_09 = defineScenario({
  id: "API-09",
  title: "An answer cleared just before submitting isn't scored from the autosaved copy",
  priority: "P1 - Critical",
  component: "API · Autosave, scoring",
  preconditions: HOW,
  steps: [
    ["setup", createQuiz("API-09 Cleared answers"), CREATED],
    ["invite", inviteOne("api09.lou@example.com"), INVITED],
    ["start", `As the participant: ${startAs}`, STARTED],
    ["autosave", "Send `POST /q/<token>/answers` with the correct answer to all three questions.", "HTTP **200** with `\"ok\":true`."],
    ["submit", "Send `POST /q/<token>/submit` with every question's answer list **empty** (`[]`).", "HTTP **200** with `{\"redirect\":\"/q/<token>/result\"}`."],
    ["result", "Send `GET /q/<token>/result`.", "HTTP **200** with **0%**, “0 of 3 correct”; the database score is 0 (the autosaved correct answers were not used)."],
  ],
});

export const API_10 = defineScenario({
  id: "API-10",
  title: "“Just a confirmation” results hide the participant's score and answers",
  priority: "P2 - High",
  component: "API · Results visibility",
  preconditions: HOW,
  steps: [
    ["setup", createQuiz("API-10 Confirmation only", " and `\"showResults\":\"none\"`"), `${CREATED} The database stores \`show_results = none\`.`],
    ["invite", inviteOne("api10.lee@example.com"), INVITED],
    ["start", `As the participant: ${startAs}`, STARTED],
    ["submit", "Send `POST /q/<token>/submit` with the correct answer to all three questions.", "HTTP **200** with `{\"redirect\":\"/q/<token>/result\"}`."],
    ["result", "Send `GET /q/<token>/result`.", "HTTP **200** with the heading “Thanks, you're all done!”; no percentage, no score line, no answer review and no “Correct answer” anywhere."],
    ["adminSees", "As the admin, open `GET /admin/quizzes/<id>?tab=results`.", "The admin still sees the result: rank 1, **100%**, **3/3**."],
  ],
});

export const API_11 = defineScenario({
  id: "API-11",
  title: "Admins can't see or change each other's quizzes",
  priority: "P1 - Critical",
  component: "API · Admin privacy",
  preconditions: HOW,
  steps: [
    ["setup", createQuiz("API-11 Private quiz"), CREATED],
    ["invite", inviteOne("api11.zoe@example.com"), INVITED],
    ["submit", `As the participant: ${startAs} Then \`POST /q/<token>/submit\` with all answers correct.`, `${STARTED} Submit returns HTTP 200 with the result redirect.`],
    [
      "addAdmin",
      `As the owner, send \`POST /admin/team\` with \`name=API Other Admin\`, \`email=api11.other@example.com\`, \`password=${API_PASSWORDS.other}\`.`,
      "HTTP **302** to `/admin/team`; the team page lists **API Other Admin** (api11.other@example.com) without the Owner badge.",
    ],
    ["otherSignIn", `In a new cookie jar, sign in as \`api11.other@example.com\` / \`${API_PASSWORDS.other}\`, then \`GET /admin\`.`, `HTTP 302 to \`/admin\`; the dashboard returns 200 and doesn't list \`${docTitle("API-11 Private quiz")}\`.`],
    [
      "otherView",
      "As the other admin, send `GET` for the owner's quiz: `/admin/quizzes/<id>`, `/admin/quizzes/<id>/edit`, `/admin/quizzes/<id>/results.csv` and the participant's `/admin/attempts/<invitation id>`.",
      "Every request returns HTTP **404** (“Quiz not found” / “Not found”).",
    ],
    [
      "otherChange",
      "As the other admin, send `POST /admin/quizzes/<id>/delete`, `POST /admin/quizzes/<id>/invite` (`recipients=api11.spy@example.com`) and `POST /admin/invitations/<invitation id>/reset`.",
      "Every request returns HTTP **404**; the owner can still open the quiz (HTTP 200), zoe's result is still 3/3, and nobody was invited as api11.spy@example.com.",
    ],
  ],
});

export const API_12 = defineScenario({
  id: "API-12",
  title: "Only the owner manages the team, and a password reset signs that admin out",
  priority: "P1 - Critical",
  component: "API · Team roles, admin passwords",
  preconditions: HOW,
  steps: [
    [
      "setup",
      `${SIGN_IN} Then send \`POST /admin/team\` with \`name=API Max\`, \`email=api12.max@example.com\`, \`password=${API_PASSWORDS.max}\`, and in a new cookie jar sign in as Max.`,
      "The owner's sign-in and Max's sign-in each return HTTP 302 to `/admin`; adding Max returns HTTP 302 to `/admin/team`.",
    ],
    [
      "roles",
      "Open `GET /admin/team` as the owner and as Max.",
      `The owner's page shows **${ADMIN.name}** with the Owner badge and an “Add admin” button; Max's page has no “Add admin” button. In the database ${ADMIN.email} is \`owner\` and api12.max@example.com is \`admin\`.`,
    ],
    [
      "removeOwner",
      "As Max, send `POST /admin/team/<owner id>/delete`, then `GET` the redirect.",
      "HTTP **302** to `/admin/team`, which shows “Only the owner of this Quiz Portal can add, remove or reset admins.”; the owner still exists.",
    ],
    [
      "addAdmin",
      `As Max, send \`POST /admin/team\` with \`name=Sneaky\`, \`email=api12.sneaky@example.com\`, \`password=${API_PASSWORDS.sneaky}\`, then \`GET\` the redirect.`,
      "HTTP **302** to `/admin/team` with the same message; no admin with the email api12.sneaky@example.com exists.",
    ],
    ["reset", "As the owner, send `POST /admin/team/<Max's id>/password`, then `GET` the redirect.", "HTTP **302** to `/admin/team`, which shows a one-time **12-character** password for Max."],
    ["signedOut", "With Max's existing session, send `GET /admin`.", "HTTP **302** to `/admin/login`: the reset signed Max out everywhere."],
    ["oldPassword", `Sign in as Max with the old password \`${API_PASSWORDS.max}\`.`, "HTTP **401** with “That email and password don't match. Check them and try again.”."],
    ["newPassword", "Sign in as Max with the one-time password from the reset.", "HTTP **302** to `/admin`."],
  ],
});

export const API_13 = defineScenario({
  id: "API-13",
  title: "CSV export lists results in rank order and neutralises spreadsheet formulas",
  priority: "P1 - Critical",
  component: "API · Results export (CSV)",
  preconditions: HOW,
  steps: [
    ["setup", createQuiz("API-13 CSV export"), CREATED],
    [
      "invite",
      "Send `POST /admin/quizzes/<id>/invite` with `recipients` on two lines: `=SUM(1+1) <api13.eve@example.com>` and `Ray Chen <api13.ray@example.com>`. Read both invitation emails.",
      "HTTP 302; one email arrives for each address, each with a link and password.",
    ],
    [
      "answer",
      "As each participant (own cookie jar), sign in and start; **Eve** submits all three answers correctly, **Ray** submits only the single-choice question correctly.",
      "Both submits return HTTP 200 with the result redirect.",
    ],
    [
      "export",
      "As the admin, send `GET /admin/quizzes/<id>/results.csv`.",
      `HTTP **200**, \`Content-Type: text/csv; charset=utf-8\`, \`Content-Disposition: attachment; filename="<quiz-title-slug>-results.csv"\` (for example \`api-13-csv-export-2026-11-09-14-05-00-results.csv\`), and the file starts with a UTF-8 byte-order mark (so Excel reads it correctly).`,
    ],
    [
      "rows",
      "Read the CSV.",
      "Header: Rank, Name, Email, Score, Out of, Percent, Time taken, Submitted at, Auto-submitted. Row 1: **1**, **'=SUM(1+1)** (a leading apostrophe, so spreadsheets show it as text instead of running it), api13.eve@example.com, 3, 3, 100%, …, no. Row 2: **2**, Ray Chen, api13.ray@example.com, 1, 3, 33%, …, no.",
    ],
  ],
});

export const API_14 = defineScenario({
  id: "API-14",
  title: "Every admin and participant page renders, and unknown pages return a friendly 404",
  priority: "P2 - High",
  component: "API · Page rendering, error pages",
  preconditions: HOW,
  steps: [
    ["setup", createQuiz("API-14 Pages"), CREATED],
    ["invite", inviteOne("api14.ida@example.com"), INVITED],
    ["submit", `As the participant: ${startAs} Then \`POST /q/<token>/submit\` with all answers correct.`, `${STARTED} Submit returns HTTP 200 with the result redirect.`],
    [
      "adminPages",
      "As the admin, `GET` each page: `/admin`, `/admin/quizzes/<id>?tab=results`, `?tab=participants`, `?tab=questions`, `/admin/quizzes/<id>/edit`, `/admin/quizzes/new`, `/admin/team`, `/admin/account`, and the participant's `/admin/attempts/<invitation id>`.",
      "Every page returns HTTP **200** HTML with a non-empty heading; the questions tab shows “1 of 1 answered correctly” for each question.",
    ],
    [
      "participantPages",
      "As the participant, `GET /q/<token>/result`, then `GET /q/<token>`.",
      "The result page returns HTTP **200** with **100%**; the link itself returns 302 to `/q/<token>/result` (the quiz is already submitted).",
    ],
    [
      "notFound",
      "Send `GET /no-such-page`, `GET /q/not-a-real-token`, and as the admin `GET /admin/quizzes/999999`.",
      "HTTP **404** each, with the headings “Page not found”, “Link not valid” and “Quiz not found”.",
    ],
  ],
});

export const API_SCENARIOS = [API_01, API_02, API_03, API_04, API_05, API_06, API_07, API_08, API_09, API_10, API_11, API_12, API_13, API_14];
