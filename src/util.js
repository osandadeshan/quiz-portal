const crypto = require("crypto");

// No look-alike characters (0/O, 1/l/I) so passwords are easy to type from an email.
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

function generatePassword(length = 10) {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += PASSWORD_ALPHABET[crypto.randomInt(PASSWORD_ALPHABET.length)];
  }
  return out;
}

function generateToken() {
  return crypto.randomBytes(24).toString("base64url");
}

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;

function isEmail(value) {
  return EMAIL_RE.test(String(value || "").trim());
}

function nameFromEmail(email) {
  return email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

/**
 * Split recipient text into entries. Lines and semicolons always separate; commas
 * separate only when a piece holds several addresses, so Outlook-style
 * "Smith, John <john@x.com>" stays one entry. Mirrored in public/js/ui.js.
 */
function splitRecipients(text) {
  return String(text || "")
    .split(/[\n;]+/)
    .flatMap((piece) => ((piece.match(/@/g) || []).length > 1 ? piece.split(",") : [piece]))
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse free-form recipient text. Accepts one entry per line or separated by
 * commas/semicolons, each either `email` or `Name <email>`. `name` is empty
 * when none was typed (callers fall back to nameFromEmail).
 */
function parseRecipients(text) {
  const valid = [];
  const invalid = [];
  const seen = new Set();
  const entries = splitRecipients(text);

  for (const entry of entries) {
    let name = "";
    let email = entry;
    const m = entry.match(/^(.*)<([^>]+)>$/);
    if (m) {
      name = m[1].trim().replace(/^"|"$/g, "");
      email = m[2].trim();
    }
    email = email.toLowerCase();
    if (!isEmail(email)) {
      invalid.push(entry);
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    valid.push({ email, name });
  }
  return { valid, invalid };
}

function formatDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "1 question", "3 questions". */
function plural(n, word, pluralWord) {
  return `${n} ${n === 1 ? word : pluralWord || word + "s"}`;
}

/**
 * A <time> element the browser re-renders in the viewer's own time zone
 * (public/js/ui.js). The text inside is the server-side fallback.
 */
function localTime(d) {
  if (!d) return "—";
  const iso = new Date(d).toISOString();
  return `<time datetime="${iso}" data-local>${formatDate(d)}</time>`;
}

/** "2026-11-09 14:05" in the server's time zone (TZ). Spreadsheets read this as a date. */
function sheetDate(d) {
  if (!d) return "";
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())} ${p(x.getHours())}:${p(x.getMinutes())}`;
}

/** CSV cell, quoted, with spreadsheet formula injection neutralised. */
function csvCell(v) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

function percent(score, max) {
  if (!max) return 0;
  return Math.round((score / max) * 100);
}

function initials(name, email) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

/** Serialize data for embedding in <script type="application/json">. */
function safeJson(data) {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

/**
 * Deterministic shuffle: the same `seed` always gives the same order, so a
 * participant sees a stable order across reloads without storing it.
 */
function seededShuffle(items, seed) {
  const h = crypto.createHash("sha256").update(String(seed)).digest();
  let a = h.readUInt32LE(0);
  const rand = () => {
    // mulberry32
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Like Promise.all(items.map(fn)) but with at most `limit` running at once. Keeps order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = {
  generatePassword,
  generateToken,
  isEmail,
  nameFromEmail,
  splitRecipients,
  parseRecipients,
  plural,
  localTime,
  sheetDate,
  csvCell,
  formatDuration,
  formatDate,
  percent,
  initials,
  safeJson,
  seededShuffle,
  mapLimit,
  asyncHandler,
};
