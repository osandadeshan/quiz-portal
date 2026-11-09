import path from "path";

/**
 * Everything the E2E suite needs to know about its throwaway stack. The stack
 * (Postgres + Mailpit + the app) is started by support/start-stack.cjs and never
 * touches the developer's own database (5433) or dev server (3001).
 */
export const PORTS = {
  app: Number(process.env.E2E_APP_PORT || 3997),
  postgres: Number(process.env.E2E_PG_PORT || 54331),
  smtp: Number(process.env.E2E_SMTP_PORT || 11025),
  mailUi: Number(process.env.E2E_MAIL_UI_PORT || 18025),
};

// 127.0.0.1 rather than localhost: some sandboxes can't resolve "localhost" from Node.
export const APP_URL = `http://127.0.0.1:${PORTS.app}`;
export const MAILBOX_URL = `http://127.0.0.1:${PORTS.mailUi}`;

export const MAIL_FROM = { name: "Quiz Portal", address: "no-reply@quiz-portal.test" };

export const ADMIN = {
  name: "E2E Admin",
  email: "e2e.admin@example.com",
  password: "E2e-Admin-Pass-2026",
};

export const TESTS_DIR = path.resolve(__dirname, "../..");
export const OUTPUT_DIR = path.join(TESTS_DIR, ".output");
export const REPO_ROOT = path.resolve(TESTS_DIR, "../..");

/** Unique per run (set once in playwright.config.ts, inherited by workers). */
export const RUN_ID = process.env.E2E_RUN_ID || "local";
