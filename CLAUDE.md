# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- **Verify before reporting done.** Run `npm run test:e2e` (Playwright API + browser tests; `npm run test:api` for a quick backend-only check). It updates `src/tests/e2e-test-scenarios.md`; look at failing steps' screenshots or HTTP logs in the Allure report. If a change alters UI text, routes or flows, update the scenarios (`src/tests/e2e/scenarios/`) and the page objects (`src/tests/e2e/pages/`, `src/tests/e2e/api/`) in the same change. Never test against the user's own database (`.env` / port 5433). The suite creates its own throwaway one.
- **The user may be running `npm run dev`** (port 3001) while you work. Don't kill it, and don't stop or remove the `quiz-portal-db-1` container or its `quiz-portal_pgdata` volume without asking.
- **Audience:** the owner wants a polished, very easy-to-use UI and documentation that a non-technical person can follow. When behaviour changes, update `README.md` (user guide, troubleshooting, env table) as well as `AGENTS.md`.
- **Git:** commit or push only when asked. The repository is `https://github.com/osandadeshan/quiz-portal` (renamed from `markdown-quiz-app`; GitHub redirects the old address). Never add Claude as a co-author in commits or PRs.
- **README screenshots** in `docs/screenshots/` were generated from demo data with headless Chromium. Regenerate them (light mode, 1280 px wide) when the screens they show change noticeably.
