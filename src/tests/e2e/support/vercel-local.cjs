#!/usr/bin/env node
/**
 * Runs Quiz Portal the way Vercel does, for tests (E2E_TARGET=vercel):
 *   1. files in public/ are served as static files (Vercel's CDN; vercel.json "outputDirectory")
 *   2. every other request goes to the serverless handler api/index.js (vercel.json "rewrites")
 *   3. VERCEL=1, so the app uses its serverless settings: no app.listen() of its own,
 *      no background sweeper (swept per request instead), lazy startup, small DB pool,
 *      no SMTP connection pooling
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

const server = http.createServer((req, res) => {
  const file = (req.method === "GET" || req.method === "HEAD") && staticFile(req.url);
  if (file) {
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "public, max-age=3600" });
    return req.method === "HEAD" ? res.end() : fs.createReadStream(file).pipe(res);
  }
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
