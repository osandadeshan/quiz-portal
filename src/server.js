const path = require("path");
const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const helmet = require("helmet");

const config = require("./config");
const db = require("./db");
const { csrf, flash } = require("./middleware");
const { icon, iconPaths } = require("./icons");
const util = require("./util");
const admins = require("./services/admins");
const attempts = require("./services/attempts");

const app = express();
const ROOT = path.join(__dirname, "..");

app.set("view engine", "ejs");
app.set("views", path.join(ROOT, "views"));
app.set("trust proxy", config.trustProxy);

app.use(
  helmet({
    strictTransportSecurity: config.https,
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:"],
        "form-action": ["'self'"],
        "upgrade-insecure-requests": config.https ? [] : null,
      },
    },
  })
);
const iconsJs = `window.ICONS=${JSON.stringify(iconPaths)};`;
app.get("/js/icons.js", (req, res) => {
  res.type("application/javascript").set("Cache-Control", "public, max-age=3600").send(iconsJs);
});
app.use(express.static(path.join(ROOT, "public"), { maxAge: config.isProd ? "1h" : 0 }));

// Health check for Docker / hosting platforms. Before the session middleware so
// probes don't create sessions.
app.get("/healthz", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.set("Cache-Control", "no-store").json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: "database unavailable" });
  }
});
app.use(express.urlencoded({ extended: false, limit: "200kb" }));
app.use(express.json({ limit: "2mb" }));

app.use(
  session({
    store: new PgSession({ pool: db.pool, tableName: "sessions", createTableIfMissing: true }),
    name: "qp.sid",
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: config.https,
      maxAge: 12 * 60 * 60 * 1000,
    },
  })
);

// express-session writes a response's headers *before* it finishes saving the
// session, so on a redirect the browser can request the next page while the old
// session is still stored, and lose a one-time flash message (even the invitation
// passwords) or a fresh sign-in. Save first, then redirect.
app.use((req, res, next) => {
  const redirect = res.redirect.bind(res);
  res.redirect = (...args) => {
    if (!req.session) return redirect(...args);
    req.session.save((err) => {
      if (err) return next(err);
      redirect(...args);
    });
  };
  next();
});

app.use((req, res, next) => {
  Object.assign(res.locals, {
    appName: config.appName,
    icon,
    fmt: util,
    currentPath: req.path,
    admin: null,
  });
  next();
});
app.use(flash);
app.use(csrf);

app.get("/", (req, res) => res.redirect("/admin"));
app.use("/admin", require("./routes/admin"));
app.use("/q", require("./routes/take"));

app.use((req, res) => {
  res.status(404).render("error", {
    title: "Page not found",
    message: "We couldn't find that page. If you were invited to a quiz, use the link from your email.",
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (req.is("json")) return res.status(500).json({ error: "Something went wrong. Please try again." });
  res.status(500).render("error", {
    title: "Something went wrong",
    message: "An unexpected error occurred. Please try again in a moment.",
  });
});

/** Wait for PostgreSQL instead of exiting (e.g. the database container is still starting). */
async function migrateWithRetry(maxWaitMs = 60000) {
  const started = Date.now();
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.migrate();
    } catch (err) {
      const retriable = ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "57P03"].includes(err.code) || /terminat|starting up|connect/i.test(err.message);
      if (!retriable || Date.now() - started > maxWaitMs) throw err;
      if (attempt === 1) console.log(`Waiting for the database (${err.code || err.message})…`);
      await new Promise((r) => setTimeout(r, Math.min(1000 * attempt, 5000)));
    }
  }
}

async function start() {
  await migrateWithRetry();
  await admins.seedFromEnv();
  const sweeper = attempts.startSweeper();
  const server = app.listen(config.port, () => {
    console.log(`${config.appName} running at ${config.appUrl}`);
    if (!require("./services/mailer").configured)
      console.log("SMTP is not configured — invitation emails will be printed here instead.");
  });

  // Finish in-flight requests, then close the database pool (docker stop, Ctrl+C).
  let stopping = false;
  const shutdown = (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} received, shutting down…`);
    clearInterval(sweeper);
    const force = setTimeout(() => process.exit(0), 8000);
    force.unref();
    server.close(() => db.pool.end().finally(() => process.exit(0)));
    server.closeIdleConnections?.();
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  return server;
}

module.exports = { app, start };
