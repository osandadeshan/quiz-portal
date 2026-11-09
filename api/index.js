/**
 * Vercel entry point. Vercel runs this file as one serverless function, and
 * vercel.json sends every request that isn't a static file in public/ here.
 *
 * Differences from `npm start` (app.js → src/server.js start()):
 *   - no app.listen(): Vercel calls this handler for each request
 *   - startup work (schema, first admin) runs once per instance, on its first request
 *   - no background timer: expired attempts are swept (at most every 20 s) before a request
 */
const { app, ready } = require("../src/server");
const attempts = require("../src/services/attempts");

module.exports = async (req, res) => {
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
  return app(req, res);
};
