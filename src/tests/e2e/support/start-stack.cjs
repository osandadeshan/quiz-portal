#!/usr/bin/env node
/**
 * Starts the throwaway E2E stack, then keeps running until Playwright stops it:
 *   - PostgreSQL 16 (container qp-e2e-pg)
 *   - Mailpit, a disposable inbox that catches every email (container qp-e2e-mailpit)
 *   - Quiz Portal itself (node app.js) pointed at both
 *
 * Playwright's `webServer` runs this file and waits for /healthz. Never touches
 * the developer's own database (5433) or dev server (3001).
 */
const { execFileSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const env = process.env;
const PORTS = {
  app: Number(env.E2E_APP_PORT || 3997),
  pg: Number(env.E2E_PG_PORT || 54331),
  smtp: Number(env.E2E_SMTP_PORT || 11025),
  mailUi: Number(env.E2E_MAIL_UI_PORT || 18025),
};
const PG = "qp-e2e-pg";
const MAIL = "qp-e2e-mailpit";
const MAILPIT_IMAGE = "axllent/mailpit:v1.33.1";
const ROOT = path.resolve(__dirname, "../../../..");
// The app's console output, also checked for errors by global teardown.
const APP_LOG = path.resolve(__dirname, "../../.output/app.log");

const log = (...a) => console.log("[e2e-stack]", ...a);
const docker = (...args) => execFileSync("docker", args, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const removeContainers = () => {
  for (const c of [PG, MAIL]) {
    try { docker("rm", "-f", c); } catch { /* not running */ }
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const httpOk = (url) =>
  new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode < 500); });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });

let app;
let stopping = false;
/** Stop the app first (it closes its DB pool), then remove the containers. */
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  const finish = () => {
    removeContainers();
    process.exit(code);
  };
  if (!app || app.exitCode !== null) return finish();
  app.once("exit", finish);
  app.kill("SIGTERM");
  setTimeout(finish, 10_000).unref();
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
process.on("exit", () => { if (!stopping) removeContainers(); });

(async () => {
  try {
    docker("version", "--format", "{{.Server.Version}}");
  } catch {
    console.error("[e2e-stack] Docker isn't running. Start Docker Desktop and try again.");
    process.exit(1);
  }
  removeContainers();
  log(`starting PostgreSQL on :${PORTS.pg} and Mailpit on :${PORTS.smtp} (SMTP) / :${PORTS.mailUi} (inbox)`);
  docker("run", "-d", "--name", PG, "-e", "POSTGRES_USER=quiz", "-e", "POSTGRES_PASSWORD=quiz", "-e", "POSTGRES_DB=quiz",
    "-p", `127.0.0.1:${PORTS.pg}:5432`, "postgres:16-alpine");
  docker("run", "-d", "--name", MAIL, "-p", `127.0.0.1:${PORTS.smtp}:1025`, "-p", `127.0.0.1:${PORTS.mailUi}:8025`, MAILPIT_IMAGE);

  for (let i = 0; ; i++) {
    try { docker("exec", PG, "pg_isready", "-U", "quiz", "-q"); break; } catch { /* starting */ }
    if (i > 120) throw new Error("PostgreSQL didn't start in time");
    await sleep(500);
  }
  for (let i = 0; !(await httpOk(`http://127.0.0.1:${PORTS.mailUi}/livez`)); i++) {
    if (i > 120) throw new Error("Mailpit didn't start in time");
    await sleep(500);
  }

  const appUrl = `http://127.0.0.1:${PORTS.app}`;
  log(`starting Quiz Portal on ${appUrl}`);
  fs.mkdirSync(path.dirname(APP_LOG), { recursive: true });
  const logFile = fs.createWriteStream(APP_LOG, { flags: "w" });
  // E2E_TARGET=vercel runs the app as Vercel does (static files + the api/index.js
  // serverless handler, VERCEL=1); the default is the normal server (npm start).
  const vercel = env.E2E_TARGET === "vercel";
  log(vercel ? "mode: Vercel (api/index.js serverless handler)" : "mode: normal server (app.js)");
  app = spawn(process.execPath, [vercel ? path.join(__dirname, "vercel-local.cjs") : "app.js"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...env,
      NODE_ENV: "development",
      PORT: String(PORTS.app),
      APP_URL: appUrl,
      APP_NAME: "Quiz Portal",
      DATABASE_URL: `postgres://quiz:quiz@127.0.0.1:${PORTS.pg}/quiz`,
      DATABASE_SSL: "false",
      SESSION_SECRET: "e2e-session-secret",
      ADMIN_NAME: env.E2E_ADMIN_NAME,
      ADMIN_EMAIL: env.E2E_ADMIN_EMAIL,
      ADMIN_PASSWORD: env.E2E_ADMIN_PASSWORD,
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(PORTS.smtp),
      SMTP_SECURE: "false",
      SMTP_USER: "",
      SMTP_PASS: "",
      MAIL_FROM: env.E2E_MAIL_FROM,
      TZ: env.TZ || "UTC",
    },
  });
  for (const [from, to] of [[app.stdout, process.stdout], [app.stderr, process.stderr]]) {
    from.on("data", (chunk) => {
      to.write(chunk);
      logFile.write(chunk);
    });
  }
  app.on("exit", (code) => {
    if (!stopping) {
      console.error(`[e2e-stack] the app exited unexpectedly (code ${code})`);
      stop(1);
    }
  });
})().catch((err) => {
  console.error("[e2e-stack]", err.message);
  stop(1);
});
