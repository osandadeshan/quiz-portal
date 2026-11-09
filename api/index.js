/**
 * Vercel entry point. Vercel runs this file as one serverless function, and
 * vercel.json sends every request that isn't a static file in public/ here.
 *
 * It must export an Express app (something with .listen), not a plain
 * (req, res) function. For a plain function Vercel adds its own "helpers" to
 * every response, replacing Express's res.redirect / res.status / res.send /
 * res.json. Vercel's res.redirect defaults to 307, which makes browsers repeat
 * a POST: after signing in the browser re-POSTed to /admin ("Session expired"),
 * and after inviting it re-POSTed the invite form to the save-quiz route.
 *
 * Differences from `npm start` (app.js → src/server.js start()):
 *   - no app.listen(): Vercel calls the app for each request
 *   - startup work (schema, first admin) runs once per instance, on its first request
 *   - no background timer: expired attempts are swept (at most every 20 s) before a request
 */
const express = require("express");
const { app, ready } = require("../src/server");
const attempts = require("../src/services/attempts");

const entry = express();
entry.disable("x-powered-by");

entry.use(async (req, res, next) => {
  try {
    await ready();
  } catch (err) {
    console.error("Startup failed:", err.message);
    res.statusCode = 503;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Retry-After", "5");
    return res.end("Quiz Portal can't reach its database right now. Please try again in a moment.");
  }
  await attempts.sweepIfDue();
  next();
});
entry.use(app);

module.exports = entry;
