const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const config = require("./config");

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
  max: config.dbPoolMax,
  // Serverless instances freeze between requests; don't hold idle connections long.
  idleTimeoutMillis: config.serverless ? 10_000 : 30_000,
});

pool.on("error", (err) => console.error("[db] idle client error", err));

const query = (text, params) => pool.query(text, params);

/** Run `fn(client)` inside a transaction. */
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Any constant works; it only has to be the same in every instance of the app.
const MIGRATION_LOCK = 72_027_001;

/**
 * Apply schema.sql (idempotent). Several instances can start at once (serverless
 * cold starts, rolling deploys), and concurrent `CREATE … IF NOT EXISTS` can still
 * collide, so instances take turns with an advisory lock.
 */
async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await client.query(sql);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => {});
    client.release();
  }
}

module.exports = { pool, query, tx, migrate };
