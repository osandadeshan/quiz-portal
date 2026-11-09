---
name: verify-quiz-portal
description: Verify Quiz Portal changes end to end against a throwaway Postgres. Use after changing routes, services, schema, views or browser JS, or when asked to test, run or check the app.
---

# Verify Quiz Portal

Always test against a **throwaway** database. Never use the developer's `.env` database (port 5433) or their running dev server (port 3001).

## 1. Playwright suite: API + browser tests (always)

```bash
npm run test:e2e          # everything, ~1.5 min: 14 API tests + 11 browser tests
npm run test:api          # only the API tests, ~25 s (good after backend-only changes)
npm run test:ui           # only the browser lifecycle tests, ~1 min
npm run test:e2e:report   # Allure report: every step with its screenshot or HTTP log
```

The suite starts its own throwaway stack: Postgres (`qp-e2e-pg`, 54331), Mailpit (`qp-e2e-mailpit`, SMTP 11025 / inbox 18025) and the app on 3997. It never touches the dev database (5433) or the dev server (3001).

- **API tests (API-01 to API-14, `src/tests/e2e/specs/api/`):** plain HTTP, no browser. They cover:
  - health check and first-run setup being locked
  - admin sign-in/out
  - CSRF
  - server-side quiz validation, including malformed JSON → 422
  - Outlook-style invitations with unique emailed credentials
  - participant sign-in, and correct answers never reaching the browser
  - one browser per link
  - autosave and all-or-nothing scoring; idempotent submit
  - cleared answers not being scored from the autosave
  - the "just a confirmation" results mode
  - admin privacy and owner-only team management, including a password reset signing the admin out
  - CSV rank order and formula-injection guard
  - every page rendering, and the 404 pages
- **Browser tests (E2E-01 to E2E-11, `src/tests/e2e/specs/ui/`):** the full quiz lifecycle in Chromium.

All must pass, and the output must end with:
```
[e2e-cleanup] app log: no errors
[e2e-cleanup] verified: every table and the inbox match the pre-run baseline
```
The teardown deletes everything the run created and fails the run if any table, the inbox or the app log isn't clean. The run rewrites `src/tests/e2e-test-scenarios.md` (statuses, date, commit). If you change UI text, routes or a flow, update the scenarios (`src/tests/e2e/scenarios/scenarios.ts` for the browser tests, `api-scenarios.ts` for the API tests) and the page objects (`src/tests/e2e/pages/`, `src/tests/e2e/api/`) together. Specs must not contain locators or selectors. The rules are in AGENTS.md → "E2E tests".

## 2. Ad-hoc checks of screens the suite doesn't cover

Prefer adding a scenario to the suite. For a quick one-off look, start the suite's stack by hand (`node src/tests/e2e/support/start-stack.cjs`, with `E2E_ADMIN_NAME`, `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD` set; Ctrl+C removes it), or the minimal stack below.

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

## 3. Clean up

```bash
lsof -nP -iTCP:3999 -sTCP:LISTEN -t | xargs kill; docker rm -f quizapp-pg
```

## 4. Production checks (when touching config, server.js or deployment files)

Copy the repo to a scratch directory, create a `.env` with `NODE_ENV=production`, `ADMIN_EMAIL` / `ADMIN_PASSWORD`, `POSTGRES_PASSWORD` and `APP_PORT=3998`, then run:

```bash
docker compose -p qp-prodtest -f docker-compose.prod.yml up -d --build
```

Confirm all of the following, then run `down -v`:
- the admin is created from the environment
- `/admin/setup` is blocked
- admin sign-in works over plain `http://`
- no HSTS header is sent for an http `APP_URL`
