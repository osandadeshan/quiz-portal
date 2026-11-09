# Quiz Portal: review, fixes and backlog

**Last review:** 2026-11-09 · **Reviewed version:** 2.0.0 (uncommitted rewrite on `main`)
**Purpose:** the shared record of what has been reviewed, what was fixed, and what's still worth doing. AI agents should read this before planning work, and update it when they close or add items. User-facing docs are in `README.md`, and engineering rules are in `AGENTS.md`.

## How the review was done

The whole codebase was read end to end (routes, services, schema, views, browser JS, CSS, Docker files, smoke test). The app was then exercised against a throwaway database through the curl smoke test and a headless-Chromium run at 1280 px and 390 px. The review covered these perspectives:

| Perspective | Focus |
|---|---|
| Senior / lead developer | correctness, races, crash paths, security, maintainability |
| Senior / lead QA engineer | edge cases, invalid input, concurrency, regression coverage |
| UI/UX engineer | clarity, mobile layout, accessibility, consistency |
| Business analyst | missing capabilities that block real use (exams, teams, reuse) |
| Personas | **Owner/admin** (non-technical, runs quizzes for staff), **second admin** (shares the server), **participant** on a phone, **participant** with a screen reader |

Severity: **High** = data/privacy loss or crash · **Medium** = wrong result or real user friction · **Low** = polish.

## Findings fixed in this round

| # | Sev | Area | Finding | Fix |
|---|---|---|---|---|
| 1 | High | Privacy | Any admin could remove any other admin (including the first) and **inherit all their private quizzes and results**, breaking the "admins can't see each other's quizzes" promise. Any admin could also add admins. | New `admins.role` (`owner`/`admin`). The first admin is owner (backfilled for existing databases). Only the owner can add, remove or reset admins (`requireOwner`). The Team page is read-only for others. |
| 2 | High | Stability | `req.session.regenerate((err) => { if (err) throw err })` in admin login, setup and participant login: a session-store error **crashed the whole process** (a throw inside a callback escapes `asyncHandler`). | Calls `next(err)`. |
| 3 | High | Security | Changing an admin password left other signed-in browsers signed in. There was no way to recover a forgotten admin password. | Password change ends every other session for that admin. The owner can **reset** another admin's password (shown once, signs them out). `npm run reset-password -- email` covers a locked-out owner. |
| 4 | Medium | Security | `trust proxy` was on for every production deployment, including plain `http://IP:3000` with no proxy, so clients could fake `X-Forwarded-For` and **dodge the sign-in rate limits**. | Trust a proxy only when `APP_URL` is https. `TRUST_PROXY` overrides it. |
| 5 | Medium | Scoring | Clearing an answer just before submitting (or while offline) could be **scored from the older autosave**, because the submit payload omitted cleared questions. | Submit sends every question, with cleared ones as `[]`. |
| 6 | Medium | Robustness | `POST /admin/quizzes` with `null` questions/options crashed with a 500. There were no length limits on question/option text (multi-MB payloads). | Null-safe validation. Limits shared by server and builder (`LIMITS`): question 2000, option 500 characters. |
| 7 | Medium | Concurrency | Saving a quiz checked "has anyone started?" outside the transaction. A participant starting mid-save could have their answers cascade-deleted. | `updateQuiz` locks the quiz row (`FOR UPDATE`) and re-checks inside the transaction. `startAttempt` takes `FOR SHARE` first. |
| 8 | Medium | Concurrency | Two simultaneous invites for the same email hit the unique constraint (500). "Allow retake" ran two statements without a transaction. | `INSERT … ON CONFLICT DO NOTHING` then refresh. `resetAttempt()` is transactional. |
| 9 | Medium | Data | Re-inviting `alice@x.com` overwrote a typed name ("Alice Wonder") with one derived from the email ("Alice"). | `parseRecipients` returns an empty name when none was typed, and existing names are kept. |
| 10 | Medium | Usability | Outlook-style lists (`Perera, Amaya <a@x.com>; b@x.com`) were split on the comma, giving an invalid entry and a wrong name. | Commas only split a piece containing several addresses (server and preview). |
| 11 | Medium | Invites | Inviting was sequential (bcrypt + SMTP per person), so large batches could time out behind a proxy. The server didn't refuse invites for a quiz without questions. | 5 at a time (`mapLimit`), pooled SMTP, cap of 500 per batch, server-side "add questions first" check. |
| 12 | Medium | Security | CSV export was open to spreadsheet **formula injection** (`=HYPERLINK(…)` in a name). | `csvCell()` prefixes `'`. Dates are now readable `YYYY-MM-DD HH:MM` in `TZ`. |
| 13 | Medium | UX | All dates rendered in the **server's** time zone (UTC in Docker), so Sri Lanka-based admins saw times 5½ h off. | `fmt.localTime()` renders `<time data-local>`, which ui.js shows in the viewer's own zone. |
| 14 | Low | UX | "1 questions", "1 minutes" on several pages. | `fmt.plural()`. |
| 15 | Low | UX | Invite card: "Each person has **15 minutes** once they press Start" broke into three columns (flex children). | Text wrapped in one span. |
| 16 | Low | UX | "Allow retake" on someone mid-quiz didn't say it interrupts them. | Labelled **Restart attempt**, with its own confirmation text. |
| 17 | Low | A11y | Moving between questions didn't move focus, so screen readers didn't announce the new question. | Focus moves to the question heading. |
| 18 | Low | Ops | No health endpoint. `docker stop` waited 10 s because SIGTERM wasn't handled. | `GET /healthz` (DB check, compose healthcheck). Graceful shutdown closes the server and the pool. |
| 20 | Medium | Timer | *(Found by the Playwright E2E suite, 2026-11-09.)* The deadline was written with the **database** clock (`now()`), but the countdown and the expiry/grace checks used the **app server's** clock (`Date.now()`). With just ~25 ms of skew the timer showed **15:01** on a 15-minute quiz. With a database on another machine, seconds of skew would shift the timer and the 15 s grace period. | `getInvitationByToken` and `finalizeAttempt` select `db_now_ms`. `attempts.clockOf()` feeds `isPastGrace`, the auto-submit check and the countdown's `serverNow`. |
| 21 | High | Sessions | *(Found by the E2E suite's intermittent failures.)* express-session sends a response's headers **before** the session save finishes, so after a form POST the browser could follow the redirect and load the **old** session. One-time flash messages were lost at random, including the **Share invitations panel with participant passwords** (shown only once), and a fresh sign-in could bounce back to the login page. | `res.redirect` now waits for `req.session.save()` (`src/server.js`), as express-session recommends for redirects. Three back-to-back E2E runs were all green. |
| 19 | Low | Builder | Client and server validation messages and limits had drifted (e.g. multiple-answer "Tick at least one…", the 300-question limit). | Aligned. |

## Gaps closed with new features

| Feature | Why (persona) | Where |
|---|---|---|
| **What participants see after submitting:** score + answers / score only / just a confirmation | Exams and reusable quizzes can't show correct answers (BA, admin) | `quizzes.show_results`, builder radio cards, `take/result.ejs`, start-page rule |
| **Per-question statistics:** % correct per question, picks per option | "Which topics need more training?" (admin, BA) | Questions tab, `attempts.questionStats()` |
| **Live progress:** answered count and minutes left for in-progress participants | Invigilating a live session (admin) | Participants tab, attempt page |
| **Import questions** from pasted text, including the old Markdown quiz files | Typing 40 questions by hand is the biggest builder pain point. Lets the four quizzes deleted in the v2 rewrite be brought back (`git show 33e20d5:"quizzes/Quiz 1 - Basic QA Concepts.md"`) | Builder dialog, `parseImport()` in `builder.js` |
| **Owner role and password reset** | Shared server with several admins (second admin, owner) | Team page, `scripts/reset-admin-password.js` |

## Verification

- `smoke.sh` (since replaced by the Playwright API tests, see below): **40 passed, 0 failed** (14 new checks: team roles, reset sign-out, healthz, malformed JSON, recipient parsing, CSV guard, stats, results visibility, cleared-answer scoring).
- Headless Chromium (28 checks): import parsing of the old Markdown format, results setting, Outlook invite list, participant flow with focus handling, score-only result, live progress, local `<time>`, stats, owner reset, read-only team for a non-owner, **no sideways scroll at 390 px** on every admin page and the take page, **no page errors**.
- README screenshots `03-quiz-builder.png` and `14-participants.png` regenerated (light mode, 1280 px).

## Automated E2E suite (added 2026-11-09)

`npm run test:e2e` runs 11 Playwright scenarios (E2E-01 to E2E-11) against a throwaway Postgres, a Mailpit mailbox and the app:
- admin sign-in
- building a 10-question quiz with all three types
- inviting three people by email
- each person reading the email in the inbox and taking the quiz with planned answers
- the ranking 1/2/3
- per-person answer review (exact selections, in the order each person saw them)
- retake blocked
- question statistics
- CSV export

**Clean-up:** a global setup/teardown pair (`src/tests/e2e/support/cleanup.ts`) records a baseline of every table and the inbox, then deletes everything the run created and verifies an exact match, on pass, fail and Ctrl+C (all three checked). The first version found that admin timestamps lost microseconds on a JS round trip; rows are restored through `to_jsonb` / `jsonb_populate_record`. **CI:** `.github/workflows/e2e.yml` runs smoke + E2E on every PR.

**API tests replace the curl smoke test (2026-11-09):** `smoke.sh` was moved into the Playwright suite as 14 API tests (API-01 to API-14, `src/tests/e2e/specs/api/`). They're plain HTTP, no browser, with the same documentation, Allure steps (each step attaches its HTTP requests and responses) and verified cleanup as the browser tests. CI now has one job. Why:
- one style and one report
- documented, manually executable steps
- no dependency on a script in `.claude/`
- the bash version had a Linux-only SIGPIPE bug: `curl | grep -q` under `pipefail` failed "ranking" on the CI runner and could have falsely passed "answers not leaked"

Coverage is the same as smoke.sh except first-run setup *creating* an admin (the E2E stack seeds its admin from env). API-01 checks the opposite instead: setup is locked once an admin exists. The "server log has no errors" check moved into global teardown (`src/tests/.output/app.log`).

**Planted-bug check for the API tests:** ten bugs, planted one at a time in a copy of the app, were all caught:

| Planted bug | Caught by |
|---|---|
| CSRF check disabled | API-03 |
| Admins can open each other's quizzes | API-11 |
| Correct answers sent to the participant | API-06 |
| Any admin can manage the team | API-12 (a non-owner deleted the owner, so later tests couldn't sign in. Cleanup now **re-inserts** deleted baseline admins exactly) |
| CSV formulas not neutralised | API-13 |
| Submit scores the autosave, ignoring cleared answers | API-09 (+4 others) |
| A second sign-in doesn't sign out the first | API-07 |
| Quiz title length not validated | API-04 |
| First-run setup open after an admin exists | API-01 |
| "Just a confirmation" shows the full review | API-10 |

The test cases (baby steps, expected results, priority, component, last status, date and commit) are generated into `src/tests/e2e-test-scenarios.md`. Allure shows every step with a full-page screenshot.

**Mutation check:** six bugs were planted, one at a time, in a copy of the app, and the suite caught every one:

| Planted bug | Caught by |
|---|---|
| Scoring accepts a partial multiple-answer selection | E2E-05 (score and percent) |
| Correct answers sent to the participant's browser | E2E-04 ("no correct-answer information is sent to the browser") |
| Admin answer view ignores the participant's option order | E2E-08 (option order per question) |
| Ranking sorts the lowest score first | E2E-07 (rank table) |
| Options saved in reverse order | E2E-02 (Questions tab) |
| Invitation email shows the wrong question count | E2E-04 (email summary) |

## Hosting moved to Vercel (2026-11-09)

Render is no longer documented. The primary hosting is **Vercel + Neon** (README section 8, option A); self-hosting with Docker stays as option B. The repository was renamed `markdown-quiz-app` → `quiz-portal`, and the links and remote now use the new name.

What changed in the app for serverless (all no-ops outside Vercel):
- `api/index.js` handler and `vercel.json`: static `public/` on the CDN, everything else to one function, with `views/**` and `src/schema.sql` bundled via `includeFiles` (checked with a local `vercel build`: all 21 templates and the schema are in the bundle)
- lazy, memoized startup (`ready()`)
- the per-request `sweepIfDue()` replaces the 20 s timer
- migrations serialised with a Postgres advisory lock (six instances migrating at once succeeded)
- a small DB pool (`DB_POOL_MAX`)
- no SMTP pooling
- `APP_TIMEZONE` for CSV dates, because Vercel reserves `TZ`

The full Playwright suite passes in Vercel mode (`E2E_TARGET=vercel`, 25/25), and CI runs the API tests in that mode on every PR.

## Fix: "Session expired" on sign-in (reported after the Vercel deploy, 2026-11-09)

**Symptom:** clicking **Sign in** showed "Session expired", and a refresh then showed the admin signed in.

**Cause:** the sign-in form was sent twice. On Vercel the first sign-in can take a few seconds (the function and the Neon database waking up), and pressing Enter while waiting sends the form again. The button's loading style only blocked a second *mouse* click.
1. The first request signs in and regenerates the session.
2. The second copy carries the old session's CSRF token, so it got the 403 page.
3. The first response's cookie was already stored, so a refresh showed the admin signed in.

Reproduced with curl and with the new tests on the old code.

**Fix:**
- `ui.js` sends each POST form once.
- A stale token on a sign-in form redirects to `?expired=1` without saving a session, so the signed-in cookie survives. Signed-in people go straight on; others see a short note.
- App pages are `Cache-Control: no-store`, which also stops cached results showing after sign-out on a shared computer.

**Tests:**
- API-15: double submit for admins and participants; must fail on the old code.
- E2E-01: Enter pressed while signing in, so the first request is held back; exactly one request may go out.

## Backlog (prioritised, not yet done)

| P | Item | Notes |
|---|---|---|
| P1 | **Unit tests** | The Playwright suite (API + browser) runs in CI on every PR (`.github/workflows/e2e.yml`, Allure report as an artifact). There are no unit tests yet. Start with `node --test` for `validateQuiz`, `parseRecipients`, `parseImport` (move it to a shared module), `isAnswerCorrect` and `csvCell`, and add them to the same workflow. |
| P1 | **Shared rate-limit store on Vercel** | express-rate-limit uses an in-memory store, so on Vercel each function instance counts failed sign-ins separately and the limit is weaker. Add a small Postgres-backed store (a `rate_limits` table keyed by limiter + key, with an expiry) or Upstash Redis, and use it when `config.serverless`. |
| P1 | **Add extra time / extend deadline** for one in-progress participant | Accessibility accommodations, technical problems. Update `deadline_at` and the client picks it up via `/ping` (return `deadline`). |
| P1 | **Availability window** (opens at / closes at) | Today closing is manual. Add `opens_at`/`closes_at` and have the sweeper close the quiz. |
| P2 | **Pass mark** (pass/fail badge, filter, CSV column) | Common for compliance training. |
| P2 | **Shuffle question order** per participant | Same seeded approach as options. Keep the admin attempt view in the participant's order. |
| P2 | **Detailed CSV** (one column per question: chosen answers, correct?) | For analysts. Builds on `questionStats`. |
| P2 | **Reminder / bulk resend** to people who haven't started | Needs new passwords (hashes only) or a "reminder without password" email. |
| P2 | **Participants tab search, filter and bulk remove** | Gets unwieldy past ~100 people. |
| P2 | **Transfer ownership** / change admin email | The owner role is currently fixed to the first admin. |
| P3 | Free-text questions with manual marking | The old Markdown format had `[text]`. Needs a grading UI. |
| P3 | Images in questions | Needs uploads and a storage decision. |
| P3 | Audit log (who closed/reset/deleted/reset passwords) | Useful once there are several admins. |
| P3 | Admin 2FA (TOTP) | |
| P3 | Background job for very large invite batches (> 500) | The current request is synchronous. |
| P3 | Full accessibility audit (contrast in dark mode, builder keyboard flow, screen-reader pass) | |

## Known, accepted trade-offs

- The browser's `auto` flag on submit is client-claimable, but harmless: `submitted_at = LEAST(now(), deadline_at)` and the score don't depend on it.
- Number keys toggle radio answers, so pressing the same number twice clears the answer (consistent with click-to-unselect).
- After a correct password, a participant can still reach the "quiz closed" page. That's intended, so people who already submitted can still see their result.
- Sessions for anonymous visitors are created by the CSRF middleware. `connect-pg-simple` prunes expired rows.
