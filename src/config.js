require("dotenv").config();

const env = process.env;
const isProd = env.NODE_ENV === "production";

if (!env.DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set. Copy .env.example to .env and fill it in (or run `docker compose up -d`)."
  );
  process.exit(1);
}

if (isProd && (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD)) {
  console.warn(
    "ADMIN_EMAIL / ADMIN_PASSWORD are not set. If no admin exists yet, set them to create the first admin (browser setup is disabled in production)."
  );
}

if (isProd && !env.SESSION_SECRET) {
  console.error("SESSION_SECRET must be set in production.");
  process.exit(1);
}

const port = Number(env.PORT) || 3000;
const appUrl = (env.APP_URL || `http://localhost:${port}`).replace(/\/+$/, "");
const https = appUrl.startsWith("https://");

/**
 * Express "trust proxy". An https APP_URL means a proxy (Render, nginx, Caddy…)
 * terminates TLS in front of the app, so trust one hop. On plain http there is
 * usually no proxy; trusting X-Forwarded-For there would let anyone fake their IP
 * and dodge the sign-in rate limits. TRUST_PROXY overrides (true/false/number/list).
 */
function trustProxy(value) {
  if (value === undefined || value === "") return https ? 1 : false;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

module.exports = {
  isProd,
  port,
  appName: env.APP_NAME || "Quiz Portal",
  appUrl,
  // HTTPS-only protections (secure cookies, HSTS, upgrading requests) are enabled
  // when the public URL is https. Plain-http setups (e.g. http://SERVER-IP:3000) still work.
  https,
  trustProxy: trustProxy(env.TRUST_PROXY),
  databaseUrl: env.DATABASE_URL,
  databaseSsl: env.DATABASE_SSL === "true",
  sessionSecret: env.SESSION_SECRET || "dev-only-insecure-secret",
  admin: {
    name: env.ADMIN_NAME || "Administrator",
    email: env.ADMIN_EMAIL,
    password: env.ADMIN_PASSWORD,
  },
  smtp: {
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT) || 587,
    secure: env.SMTP_SECURE === "true",
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.MAIL_FROM || env.SMTP_USER,
  },
  // Most people in one invite batch (keeps a single request from running for ages).
  maxInvitesPerBatch: 500,
  // Seconds of slack after the deadline to accept the browser's final auto-submit.
  submitGraceSeconds: 15,
};
