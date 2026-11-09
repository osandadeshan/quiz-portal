# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- **Verify before reporting done.** Run `bash .claude/skills/verify-quiz-portal/scripts/smoke.sh` after backend changes. For UI, browser-JS, route or service changes, also run `npm run test:e2e` (Playwright; it updates `src/tests/e2e-test-scenarios.md`) and look at failing steps' screenshots. If a change alters UI text or flows, update `src/tests/e2e/scenarios/scenarios.ts` and the page objects in the same change. Never test against the user's own database (`.env` / port 5433). Use the throwaway one the skill creates.
- **The user may be running `npm run dev`** (port 3001) while you work. Don't kill it, and don't stop or remove the `quiz-portal-db-1` container or its `quiz-portal_pgdata` volume without asking.
- **Audience:** the owner wants a polished, very easy-to-use UI and documentation that a non-technical person can follow. When behaviour changes, update `README.md` (user guide, troubleshooting, env table) as well as `AGENTS.md`.
- **Git:** commit or push only when asked. The GitHub remote is still named `markdown-quiz-app`, even though the app and folder are now Quiz Portal / `quiz-portal`.
- **README screenshots** in `docs/screenshots/` were generated from demo data with headless Chromium. Regenerate them (light mode, 1280 px wide) when the screens they show change noticeably.
