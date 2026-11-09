const crypto = require("crypto");
const { rateLimit } = require("express-rate-limit");

/** Per-session CSRF token, checked on every state-changing request. */
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString("base64url");
  res.locals.csrfToken = req.session.csrf;
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const sent = req.get("x-csrf-token") || req.body?._csrf;
  const ok =
    typeof sent === "string" &&
    sent.length === req.session.csrf.length &&
    crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(req.session.csrf));
  if (ok) return next();
  if (req.is("json") || req.xhr) return res.status(403).json({ error: "Your session expired. Reload the page and try again." });
  res.status(403);
  return res.render("error", {
    title: "Session expired",
    message: "For your security this form expired. Go back, reload the page and try again.",
  });
}

/** One-shot flash messages: req.flash('success', 'Saved'). */
function flash(req, res, next) {
  // Messages are taken only by a page that actually shows them (the flash
  // partial calls takeFlash). Other requests on the same session — 404s, JSON
  // calls, a stray favicon fetch — can't swallow a one-time message such as the
  // invitation passwords.
  let taken = null;
  res.locals.takeFlash = () => {
    if (taken === null) {
      taken = req.session.flash || [];
      delete req.session.flash;
    }
    return taken;
  };
  req.flash = (type, message, extra) => {
    req.session.flash = req.session.flash || [];
    req.session.flash.push({ type, message, ...extra });
  };
  next();
}

function requireAdmin(req, res, next) {
  if (req.session.adminId) return next();
  if (req.is("json")) return res.status(401).json({ error: "Please sign in again." });
  req.session.returnTo = req.originalUrl;
  return res.redirect("/admin/login");
}

const { ipKeyGenerator } = require("express-rate-limit");

const tooMany = (req, res) => {
  res.status(429).render("error", {
    title: "Too many attempts",
    message: "Too many incorrect passwords. Please wait 15 minutes and try again.",
    participant: req.baseUrl === "/q",
  });
};

/**
 * Brute-force protection for sign-in forms. Only FAILED attempts count
 * (skipSuccessfulRequests), so many people behind one office/school IP can
 * all sign in normally.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: tooMany,
});

/** Same, but counted per quiz link, so one link can't lock out everyone else. */
const participantLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${req.params.token}`,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: tooMany,
});

module.exports = { csrf, flash, requireAdmin, loginLimiter, participantLoginLimiter };
