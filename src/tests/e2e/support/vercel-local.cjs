#!/usr/bin/env node
/**
 * Runs Quiz Portal the way Vercel does, for tests (E2E_TARGET=vercel):
 *   1. files in public/ are served as static files (Vercel's CDN; vercel.json "outputDirectory")
 *   2. every other request goes to the serverless handler api/index.js (vercel.json "rewrites")
 *   3. VERCEL=1, so the app uses its serverless settings: no app.listen() of its own,
 *      no background sweeper (swept per request instead), lazy startup, small DB pool,
 *      no SMTP connection pooling
 *
 *   4. Vercel's Node.js helpers when (and only when) Vercel would add them
 *
 * It doesn't emulate Vercel's file bundling. `npx vercel build` checks that
 * (see AGENTS.md → Vercel).
 */
process.env.VERCEL = "1";
const http = require("http");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "../../../..");
const PUBLIC = path.join(ROOT, "public");
const handler = require(path.join(ROOT, "api", "index.js"));
const TYPES = { ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const port = Number(process.env.PORT) || 3000;

function staticFile(urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC + path.sep)) return null;
  try {
    return fs.statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

/**
 * Vercel's Node.js "helpers", added exactly when Vercel adds them: when the
 * exported handler is a plain function (no .listen). They replace Express's
 * res.redirect/status/send/json with Vercel's (redirect defaults to 307) and
 * make req.body/query/cookies lazy properties. Mirrors addHelpers() in @vercel/node
 * (dev-server.mjs), so the tests see what production sees.
 */
async function addVercelHelpers(req, res) {
  // Vercel makes req.body/query/cookies lazy properties that can be overwritten
  // (setLazyProp). The body itself isn't emulated: the request stream is left
  // for Express's own body parser, which is what matters for these tests.
  for (const prop of ["body", "query", "cookies"]) {
    let value;
    Object.defineProperty(req, prop, {
      configurable: true,
      enumerable: true,
      get: () => value,
      set: (v) => Object.defineProperty(req, prop, { configurable: true, enumerable: true, writable: true, value: (value = v) }),
    });
  }
  res.status = (code) => ((res.statusCode = code), res);
  res.redirect = (statusOrUrl, url) => {
    if (typeof statusOrUrl === "string") [url, statusOrUrl] = [statusOrUrl, 307];
    res.writeHead(statusOrUrl, { Location: url }).end();
    return res;
  };
  res.send = (body) => (res.end(typeof body === "object" && !Buffer.isBuffer(body) ? JSON.stringify(body) : body), res);
  res.json = (body) => (res.setHeader("Content-Type", "application/json; charset=utf-8"), res.end(JSON.stringify(body)), res);
}
const usesHelpers = typeof handler.listen !== "function";
if (usesHelpers) console.warn("[vercel-local] api/index.js exports a plain function: Vercel will add its helpers (307 redirects!)");

const server = http.createServer(async (req, res) => {
  const file = (req.method === "GET" || req.method === "HEAD") && staticFile(req.url);
  if (file) {
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "public, max-age=3600" });
    return req.method === "HEAD" ? res.end() : fs.createReadStream(file).pipe(res);
  }
  if (usesHelpers) await addVercelHelpers(req, res);
  Promise.resolve(handler(req, res)).catch((err) => {
    console.error("[vercel-local] handler error", err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});
server.listen(port, () => console.log(`Quiz Portal (Vercel mode) running at http://127.0.0.1:${port}`));

const stop = () => server.close(() => require(path.join(ROOT, "src", "db")).pool.end().finally(() => process.exit(0)));
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
