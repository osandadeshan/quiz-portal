# AGENTS.md — Quiz Portal

Guidance for AI coding agents and contributors working in this repository.
User-facing documentation (setup, usage, deployment) lives in `README.md`; keep both in sync when behaviour changes.
The latest full code/QA/UX review, what was fixed, and the prioritised backlog are in `docs/REVIEW.md`. Read it before planning new work and update it when you close or add items.

## What this is

Quiz Portal is a web app for timed quizzes:
- **Admins** sign in at `/admin`, build quizzes (single choice, Yes/No, multiple answers), invite participants by email, and see ranked results plus every answer.
- **Participants** have no account. Each invitation is a private link `/q/<token>` plus a unique password. They can only take that one quiz, once.

Stack: Node.js (18+; developed on 25) · Express 4 · EJS server-rendered views · PostgreSQL (`pg`) · sessions in Postgres (`connect-pg-simple`) · plain browser JS/CSS (no build step) · Nodemailer · bcryptjs · helmet · express-rate-limit.

## Commands

```bash
npm install
docker compose up -d        # dev Postgres on host port 5433 (compose project name "quiz-portal")
cp .env.example .env        # first time only
npm run dev                 # nodemon; app on PORT from .env (default 3000)
npm start                   # production start
npm run reset-password -- you@example.com   # new random admin password (owner locked out)
npm run test:e2e            # Playwright suite: API + browser tests (throwaway DB + Mailpit + app, ~1.5 min)
npm run test:api            # only the API tests (~25 s)
npm run test:ui             # only the browser tests (~1 min)
npm run test:e2e:report     # Allure report of the last E2E run
npm run test:e2e:doc        # regenerate src/tests/e2e-test-scenarios.md
npx vercel build                                           # check the Vercel bundle locally (no account needed with a stub .vercel/project.json)
E2E_TARGET=vercel npm run test:e2e                         # run the suite against the app in Vercel mode
docker build -t quiz-portal .                              # production image
docker compose -f docker-compose.prod.yml up -d --build    # app + DB on any server
```

There is no unit-test framework yet. **Verify every change with the Playwright suite** (`npm run test:e2e`; `npm run test:api` is enough for a quick backend-only check) (see "E2E tests" below and `.claude/skills/verify-quiz-portal/SKILL.md`).

## Layout

```
app.js                    entry for npm start / Docker → src/server.js start()
api/index.js              entry on Vercel: serverless handler → ready() + sweepIfDue() + the same Express app
vercel.json               Vercel: public/ as static output, rewrite everything else to /api, includeFiles views/** + src/schema.sql
src/server.js             helmet/CSP, static, body parsers, session, locals, flash, csrf, routes, 404/500, ready() (migrate with retry + seed admin, memoized), start() (ready + sweeper + listen)
src/config.js             env parsing; exits if DATABASE_URL missing; `config.https` = APP_URL starts with https
src/schema.sql            idempotent schema, run on every boot (CREATE … IF NOT EXISTS / ALTER … ADD COLUMN IF NOT EXISTS)
src/db.js                 pg Pool, query(), tx(fn), migrate()
src/middleware.js         csrf, flash (takeFlash), requireAdmin, loginLimiter, participantLoginLimiter
src/util.js               tokens, passwords, parseRecipients, seededShuffle, formatters, safeJson, asyncHandler
src/tests/                Playwright E2E suite (config, e2e/, generated e2e-test-scenarios.md); see "E2E tests"
src/icons.js              SVG paths, used server-side (icon()) and served as /js/icons.js (window.ICONS)
src/routes/admin.js       /admin/*  (all routes after the auth guard are owner-scoped)
src/routes/take.js        /q/:token/*  participant flow
src/services/quizzes.js   validateQuiz (mirrors public/js/builder.js), CRUD, questionsForParticipant
src/services/attempts.js  invitations, claimSession, saveAnswers, finalizeAttempt, sweeper, rankedResults
src/services/admins.js    admin accounts; create() claims orphan quizzes for the very first admin
src/services/mailer.js    inviteEmail() (HTML + text) and sendInvite(); falls back to console when SMTP unset
views/                    EJS: partials/ (head, foot, admin-top/bottom, flash, review, brand), admin/, take/, error.ejs
public/js/ui.js           shared helpers (window.UI: icon, h, toast, csrf, confirmDialog) + global behaviours
public/js/builder.js      quiz builder (client-side state, validation, save via JSON)
public/js/take.js         quiz player (timer, autosave, ping, navigator, submit)
public/css/app.css        design system (CSS variables, light + dark via prefers-color-scheme)
scripts/                  reset-admin-password.js (npm run reset-password)
docs/REVIEW.md            review findings, fixes and backlog (keep current)
docs/screenshots/         README images
```

## Data model

`admins` (`role` owner|admin) 1─* `quizzes` (`created_by`, `show_results` full|score|none) 1─* `questions` 1─* `options` (`is_correct`)
`quizzes` 1─* `invitations` (token, password_hash, status, started_at, deadline_at, submitted_at, score, session_key, sign_in_count) 1─* `answers` (option_ids int[], is_correct)

Invitation status: `invited` → `in_progress` (Start) → `submitted` (submit, timer expiry, or quiz closed). "Allow retake" resets it to `invited`.
Question types: `single`, `yesno` (options are always exactly Yes, No), `multiple`.

## Invariants: do not break these

1. **Admin privacy.** Every admin route that loads a quiz or invitation must be scoped to `created_by = req.admin.id` (`loadQuiz` and `loadInvitation` in `routes/admin.js` return 404 otherwise). New queries must do the same.
2. **Correct answers never reach the participant's browser** before submission. The `/take` payload only includes option `id` and `text`.
3. **The server owns the timer.** `deadline_at` is set at Start. The browser countdown is cosmetic. Expired attempts are finalized by the sweeper (every 20 s; on Vercel `sweepIfDue()` before requests), by any request (`loadInvite`), and on submit. There is a 15 s grace period (`config.submitGraceSeconds`). **Compare deadlines with the database clock** (`attempts.clockOf(inv)` / `db_now_ms`), never `Date.now()`: `deadline_at` comes from Postgres `now()`, and mixing clocks made the countdown show 15:01 on a 15-minute quiz (caught by the E2E suite).
4. **Scoring is all-or-nothing** (selected set == correct set). Ranking: `RANK() OVER (ORDER BY score DESC, time_taken ASC)`.
5. **Questions lock once anyone has started** (`questionsLocked`). The title, description and duration stay editable; `shuffle_options` locks with the questions.
6. **One browser per link.** Each sign-in stores a new `session_key` on the invitation; the session holds `inviteKeys[invitationId]`. A stale key means "signed out elsewhere". `/q/:token/ping` is polled every 15 s.
7. **Option shuffling is deterministic**: `seededShuffle(options, token + ":" + questionId)`. Use `questionsForParticipant()` wherever options are shown to or about a participant (take page, participant result, admin attempt view). Yes/No is never shuffled.
8. **Plaintext participant passwords exist only once**: in the invite response, as flash `credentials` for the Share panel, and in the email. They're stored as bcrypt hashes. "Share again" regenerates them.
9. **Flash messages are consumed lazily** through `takeFlash()`, called only by `views/partials/flash.ejs`. Don't go back to eagerly reading `req.session.flash` in middleware: unrelated requests (404s, JSON) would swallow the one-time password panel. `res.redirect` is wrapped in `server.js` to `req.session.save()` first (express-session otherwise starts the response before saving, and the next page can load the old session). Don't bypass it with `res.writeHead(302)` or a manual `Location` header.
10. **CSRF on every non-GET.** Forms use a hidden `_csrf`; fetch calls send the `X-CSRF-Token` header (read from `<meta name="csrf-token">` via `UI.csrf()`).
11. **CSP is strict** (`script-src 'self'`): no inline scripts or inline event handlers. Pass data to the page with `<script type="application/json">` and `util.safeJson()`, and attach behaviour in `public/js/*`. Inline `style=` attributes are allowed.
12. **HTTPS-only features depend on `APP_URL`**: secure cookies, HSTS and upgrade-insecure-requests apply only when `config.https`. Plain `http://IP:3000` deployments must keep working.
13. **Production disables browser admin setup** (`/admin/setup` returns 403 when `NODE_ENV=production`). The first admin comes from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
14. **Rate limits count failed sign-ins only** (`skipSuccessfulRequests`). Participant limits are keyed by IP and token, so many people behind one NAT can sign in.
15. **Only the owner manages the team.** `admins.role = 'owner'` (the first admin; backfilled to the earliest admin by `schema.sql`) is the only one who can add, remove or reset admins (`requireOwner` in `routes/admin.js`). Otherwise any admin could remove another and inherit their private quizzes.
16. **Results visibility.** `quizzes.show_results`: `full` shows score + review, `score` hides the review, `none` hides score too. `views/take/result.ejs` must not render correct answers unless it's `full`. It stays editable when questions are locked.
17. **Password changes end other sessions.** `admins.endSessions()` deletes rows in the `sessions` table by `sess->>'adminId'` (account password change keeps the current `req.sessionID`; owner reset and removal end all).
18. **`req.session.regenerate` callbacks call `next(err)`**, never `throw`: a throw inside that callback escapes `asyncHandler` and crashes the process.

## Vercel (primary hosting)

Production runs on Vercel (README section 8, option A: Vercel + Neon). Docker (`docker-compose.prod.yml`) is the self-hosting alternative. Both must keep working.

- **One serverless function.** `api/index.js` wraps the Express app. `vercel.json` (`framework: null`) serves `public/` from the CDN, rewrites everything else to `/api`, and bundles `views/**` and `src/schema.sql` via `includeFiles`. Vercel ignores `express.static()`, so every static asset must live in `public/`. A new runtime-read file or folder (templates, SQL, JSON) must be added to `includeFiles`. Check with `npx vercel build`: `.vercel/output/functions/api/index.func/.vc-config.json` → `filePathMap` lists what's bundled.
- **No long-running process.** Never rely on `app.listen`, `setInterval` or work after the response on Vercel. `config.serverless` (`VERCEL=1`):
  - startup is lazy (`ready()`, memoized; a failure isn't cached)
  - the sweeper is replaced by `attempts.sweepIfDue()` before each request (at most every 20 s per instance)
  - the DB pool is small (`DB_POOL_MAX`, 3)
  - nodemailer doesn't pool
- **Many instances, one database.** `db.migrate()` takes a Postgres advisory lock, so concurrent cold starts don't collide on `CREATE … IF NOT EXISTS`. In-memory state is per instance, so treat it as a cache only. The sign-in rate limits (express-rate-limit MemoryStore) are therefore weaker on Vercel; see the backlog in docs/REVIEW.md.
- **`TZ` is reserved on Vercel.** CSV dates use `APP_TIMEZONE` (`config.timeZone`, validated with `Intl`) in `util.sheetDate`.
- **Test it:** `E2E_TARGET=vercel` makes `start-stack.cjs` run `support/vercel-local.cjs`: static files from `public/` first, then `api/index.js`, with `VERCEL=1`. CI runs the API tests in this mode before the normal full run.

## E2E tests (Playwright, `src/tests`)

- **Two groups, one suite:** API tests (`specs/api/`, project `api`, IDs API-…) make plain HTTP requests with no browser. Browser tests (`specs/ui/`, project `chromium`, IDs E2E-…) run the quiz lifecycle in Chromium. They share fixtures, the step runner, the stack and the cleanup. Each API test is independent: its own quiz (title starts with its ID) and its own `apiNN.*@example.com` participants. The browser tests are serial.
- **Source of truth:** `src/tests/e2e/scenarios/scenarios.ts` (browser) and `scenarios/api-scenarios.ts` (API) define every test case (ID, title, priority, component, preconditions, and steps as action + expected result). `e2e-test-scenarios.md` is **generated** from it by the custom reporter after each run: per-case status, date and commit, plus a top-of-file **Overall status** (PASSED only if every case passed in that same run and the run, including the teardown checks, passed; otherwise FAILED with the reasons), the execution date and the commit. The reporter's `onEnd` runs after global teardown, so a failed cleanup check makes it FAILED. Results live in `scenarios/last-results.json` (`{ run, cases }`). Note: `--reporter=…` on the command line replaces the configured reporters, so the table isn't updated on such runs or by `npm run test:e2e:doc`. Never edit the Markdown by hand.
- **Specs reference steps by key:** `await steps.step("key", act, verify)`. The step's action is the `test.step` name (and the Allure step), `verify` runs inside a nested `Verify: <expected>` step, and evidence is attached at the end of every step: a full-page screenshot (browser tests, after `steps.use(page)`) and/or every HTTP request and response made during the step (API tests, from `api/HttpSession.ts`'s log). `verify` is required: every step must assert its intention, and a passing step with no evidence fails.
- **The `steps` fixture enforces sync:** the test title must equal `scenario.testTitle`, and a passing test must have run every documented step, in order.
- **Page Object Model:** all locators live in `src/tests/e2e/pages/**` (admin, participant, mail, components). Specs and flows contain no `page.locator` / `getBy*` calls; they use page-object methods and locators with web-first `expect`. The API tests follow the same rule: all HTML selectors and endpoints live in `src/tests/e2e/api/` (`AdminApi`, `ParticipantApi`, `MailApi` (Mailpit REST), `HttpSession`: cookies, CSRF token from `<meta name="csrf-token">`, redirects never followed automatically). API specs may read the throwaway DB through `support/db.ts` (SELECT only) to prove stored state.
- **Server-rendered vs browser text:** API tests see the HTML before `public/js` runs, e.g. dates as `Nov 9, 2026, 7:58 AM` (the server's fallback inside `<time data-local>`), not the viewer's local format the browser tests see.
- **Data drives expectations:** `data/quiz.ts` (10 questions) and `data/participants.ts` (answer plans plus hard-coded expected score and rank, cross-checked at load). Derived values (stats, picks, average) come from helpers there that mirror the app's documented rules.
- **Stack:** `support/start-stack.cjs` (run by Playwright's `webServer`) starts `qp-e2e-pg` (Postgres, 54331), `qp-e2e-mailpit` (Mailpit v1.33.1, SMTP 11025 / UI 18025) and the app on 3997, then waits on `/healthz`. The tests are serial (`workers: 1`, `retries: 0`) because they share one quiz; each run gets a unique quiz title (`E2E_RUN_ID`).
- **When UI text changes,** update the page object and the scenario text together, then run `npm run test:e2e` (it rewrites the Markdown).
- **Clean-up is mandatory and verified:** `support/global-setup.ts` records a baseline (fingerprint of every table, existing ids, admin rows, id sequences, Mailpit message ids) via `support/cleanup.ts`. `support/global-teardown.ts` always runs (pass, fail, Ctrl+C) while the app is still up. It deletes the quizzes, sessions and admins the run created (children cascade), restores admin rows and sequences, deletes the run's emails, and **fails the run** if any table or the inbox differs from the baseline, or if the app's log (`src/tests/.output/app.log`, written by `start-stack.cjs`) has an error line. Anything new a test creates must be removable by that code. Add it to `OWNED` in `cleanup.ts` if it isn't a child of a quiz. The cleanup refuses to run against ports 5432/5433.
- **CI:** `.github/workflows/e2e.yml` (one job, "Playwright (API + E2E)") runs the whole suite on pull requests and pushes to `main`, and uploads the Allure report, the Playwright report and the scenarios table as artifacts. It deletes the committed table and `last-results.json` before the run and sets `E2E_COMMIT` to the PR head commit, so the job summary only ever shows that run's results.
- Output (Allure results, Playwright report, traces) goes to `src/tests/.output/` (git-ignored, ignored by nodemon).

## Conventions

- **Schema changes:** add them to `src/schema.sql` as idempotent statements (`ALTER TABLE … ADD COLUMN IF NOT EXISTS …`). There is no migration tool; the file runs on every boot.
- **Validation lives in two places:** `services/quizzes.js#validateQuiz` (authoritative) and `public/js/builder.js#validate` (instant feedback). Keep their rules and messages aligned. Length limits live in `LIMITS` in both files.
- **Async route handlers** are wrapped in `asyncHandler`. JSON endpoints return `{ error }` or `{ errors }` with proper status codes, and `{ redirect }` on success.
- **UI text** is plain and friendly, aimed at non-technical users. Destructive actions use a `<form data-confirm="…" data-confirm-title data-confirm-btn data-danger>` (handled by ui.js). Pluralize with `fmt.plural(n, "minute")` ("1 minute", "3 minutes").
- **Dates in views:** use `<%- fmt.localTime(date) %>`. It renders `<time data-local>`, which ui.js rewrites in the viewer's own time zone (the server on Vercel and in Docker runs in UTC). CSV dates use `sheetDate()` in `APP_TIMEZONE` (or the server's `TZ`).
- **Recipient parsing** is `util.splitRecipients` (server) mirrored in ui.js (preview): lines/semicolons split, commas split only when a piece has several `@`, so Outlook's `Last, First <email>` stays one entry.
- **CSV cells** go through `util.csvCell` (quotes and neutralises `= + - @` formula injection).
- **Question import** (`parseImport` in builder.js) is client-side only; the server validates the result like any builder save.
- **Dropdowns** are `<details class="dropdown">` with `.dropdown-menu`. ui.js moves an open menu to `<body>` with `position: fixed` so containers never clip it. Don't put `overflow: hidden` workarounds on tables.
- **Styling:** use CSS variables in `:root` (light) and the `prefers-color-scheme: dark` block. Layouts must work at 390px wide with no sideways scrolling (grid children get `min-width: 0`).
- **Icons:** add the path to `src/icons.js`. It's then available as `icon(name)` in EJS and `UI.icon(name)` in the browser.
- **Do not** commit `.env`, the docker volumes, or screenshots of real user data.

## Gotchas learned the hard way

- On the maintainer's machine, ports 3000 and 5432 are used by other projects. The local `.env` uses `PORT=3001`, and the dev DB is on 5433. The test suite uses 3997, 54331, 11025 and 18025.
- The `docker-compose.yml` project name is pinned (`name: quiz-portal`) so renaming the folder doesn't orphan the data volume.
- macOS filesystems are case-insensitive: `A.jar` and `a.jar` are the same file in shell tests.
- zsh arrays are 1-indexed. Run bash snippets with `bash -c` or in `.sh` files.
- `details` `toggle` events fire asynchronously. In browser tests, wait about 150 ms after clicking a summary before asserting on the floating menu.
- The builder's fixed save bar can cover elements at the bottom of the viewport. In headless tests, `scrollIntoView({ block: "center" })` before clicking.
- `nodemon` restarts on every save. If the DB is down at that moment, startup waits up to 60 s (`migrateWithRetry`) instead of exiting.
- In bash scripts with `set -o pipefail`, never pipe output into `grep -q`: grep exits at the first match, the writer gets SIGPIPE, and the check fails, or a negative check falsely passes. Capture into a variable and use `grep -q … <<<"$var"`. This passed on macOS but failed on the Linux CI runner, which is one reason the old curl smoke test became Playwright API tests.
- `trust proxy` follows `config.trustProxy` (1 only for an https `APP_URL`, overridable with `TRUST_PROXY`). Trusting proxies on a plain-http deployment lets clients spoof their IP past the rate limits.
- Node may fail to resolve `localhost` in sandboxes (nodemailer "DNS lookup for localhost timed out"). The E2E stack uses `127.0.0.1` everywhere.
- Playwright's `toHaveText(regex)` matches the raw text including leading whitespace and newlines (strings are normalised; regexes aren't). Don't anchor with `^` on elements that start with an icon or indentation.
- Don't mutate app source in place while `npm run dev` is running: nodemon reloads it. Mutation-test on a copy of the repo.
- Gmail SMTP needs an App Password (with 2-Step Verification), not the account password.
