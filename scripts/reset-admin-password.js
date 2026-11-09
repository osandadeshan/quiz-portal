#!/usr/bin/env node
/**
 * Give an admin a new random password from the command line, for when nobody
 * can sign in (for example the owner forgot theirs).
 *
 *   npm run reset-password -- you@example.com
 *   docker compose -f docker-compose.prod.yml exec app npm run reset-password -- you@example.com
 */
const db = require("../src/db");
const admins = require("../src/services/admins");

async function main() {
  const email = String(process.argv[2] || "").trim().toLowerCase();
  if (!email) {
    console.error("Usage: npm run reset-password -- admin@example.com");
    process.exitCode = 1;
    return;
  }
  await db.migrate();
  const { rows } = await db.query("SELECT id, name FROM admins WHERE email=$1", [email]);
  if (!rows[0]) {
    const { rows: all } = await db.query("SELECT email FROM admins ORDER BY created_at");
    console.error(`No admin with the email ${email}.`);
    if (all.length) console.error(`Admins: ${all.map((a) => a.email).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const password = await admins.resetPassword(rows[0].id);
  console.log(`\nNew password for ${rows[0].name} (${email}):\n\n    ${password}\n\nSign in at /admin, then change it on the Account page.`);
}

main()
  .catch((err) => {
    console.error("Couldn't reset the password:", err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
