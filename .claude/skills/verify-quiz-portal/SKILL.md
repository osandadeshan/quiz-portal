---
name: verify-quiz-portal
description: Verify Quiz Portal changes end to end against a throwaway Postgres. Use after changing routes, services, schema, views or browser JS, or when asked to test, run or check the app.
---

# Verify Quiz Portal

Always test against a **throwaway** database. Never use the developer's `.env` database (port 5433) or their running dev server (port 3001).

## 1. Backend and flow smoke test (always)

```bash
bash .claude/skills/verify-quiz-portal/scripts/smoke.sh
```

This starts a temporary Postgres container (`quiz-portal-smoke-pg`, port 54329) and the app on port 3999, then checks:
- first-run admin setup
- quiz create and validation
- CSRF
- invitations with unique credentials
- participant sign-in, start and autosave
- correct answers not leaked to the browser
- one browser per link
- all-or-nothing scoring
- ranking, CSV export (incl. formula-injection guard), admin privacy
- owner-only team management, owner password reset signing the admin out
- `/healthz`, malformed quiz JSON → 422, Outlook-style recipient parsing
- per-question stats, "just a confirmation" results mode, cleared-at-submit answers not scored
- every admin page renders, and the server log is clean

It cleans up on exit and must end with `0 failed`. Override ports with `SMOKE_PG_PORT` / `SMOKE_APP_PORT` if they're busy.

## 2. Playwright E2E suite (UI, browser JS, routes or services)

```bash
npm run test:e2e          # ~1 min; starts its own Postgres (54331), Mailpit (11025/18025) and app (3997)
npm run test:e2e:report   # Allure report: every step with a screenshot
```

All 11 scenarios must pass, and the output must end with `[e2e-cleanup] verified: every table and the inbox match the pre-run baseline` (the teardown deletes everything the run created and fails the run otherwise). The run rewrites `src/tests/e2e-test-scenarios.md` (statuses, date, commit). If you change UI text or a flow, update `src/tests/e2e/scenarios/scenarios.ts` and the page objects in `src/tests/e2e/pages/` together. Specs must not contain locators. The rules are in AGENTS.md → "E2E tests".

## 3. Ad-hoc browser checks (screens the suite doesn't cover)

The smoke test uses curl, so it doesn't run the browser scripts (`public/js/*.js`). For those:

1. Start the same throwaway stack by hand:
   ```bash
   docker run -d --name quizapp-pg -e POSTGRES_USER=quiz -e POSTGRES_PASSWORD=quiz -e POSTGRES_DB=quiz -p 54329:5432 postgres:16-alpine
   DATABASE_URL=postgres://quiz:quiz@localhost:54329/quiz PORT=3999 APP_URL=http://localhost:3999 \
     SMTP_HOST= ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=supersecret1 node app.js &
   ```
2. Drive it with `puppeteer-core`, installed in a scratch directory (not in the repo): `npm i puppeteer-core@23`. Use an existing Chromium, e.g. Playwright's at `~/Library/Caches/ms-playwright/chromium-*/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`.
3. Collect `page.on("pageerror")` errors (there must be none) and take screenshots in **light** (`emulateMediaFeatures prefers-color-scheme: light`) at 1280×800, and **mobile** at 390×844. Look at the screenshots.
4. Useful selectors:
   - admin login `#email`, `#password`, `button.btn-primary`
   - builder `#f-title`, `#f-duration`, `#f-shuffle`, `input[name="show-results"][value="full|score|none"]`, `#import-btn` → `#import-text` (set value + dispatch `input`) → `#import-summary`, `#import-ok`, `[data-q="0"] [data-input="text"]`, `[data-q="0"] [data-input="option"][data-o="0"]`, `[data-action="correct"][data-o="N"]`, `[data-add="single|multiple|yesno"]`, `#save-btn`
   - invite `#recipients`, `[data-invite-submit]`; share panel `.share-row [data-copy]`; each message contains `personal link: …` and `password: …`
   - participant `#password`, start `form[data-confirm] button` then `[data-confirm-ok]`, choices `.choice input`, `#next-btn`, `#flag-btn`, `#submit-confirm`, result `.pct`
5. Gotchas:
   - Wait about 150 ms after opening a `<details class="dropdown">`, because `toggle` is async.
   - Scroll elements to the centre before clicking, because the builder's fixed save bar covers the bottom of the viewport.
   - On macOS, cookie-jar names that differ only by case collide.
6. Check for horizontal overflow at phone width: `document.documentElement.scrollWidth` must equal `clientWidth` on every admin page.

## 4. Clean up

```bash
lsof -nP -iTCP:3999 -sTCP:LISTEN -t | xargs kill; docker rm -f quizapp-pg
```

## 5. Production checks (when touching config, server.js or deployment files)

Copy the repo to a scratch directory, create a `.env` with `NODE_ENV=production`, `ADMIN_EMAIL` / `ADMIN_PASSWORD`, `POSTGRES_PASSWORD` and `APP_PORT=3998`, then run:

```bash
docker compose -p qp-prodtest -f docker-compose.prod.yml up -d --build
```

Confirm all of the following, then run `down -v`:
- the admin is created from the environment
- `/admin/setup` is blocked
- admin sign-in works over plain `http://`
- no HSTS header is sent for an http `APP_URL`
