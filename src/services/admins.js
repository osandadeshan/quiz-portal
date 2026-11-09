const bcrypt = require("bcryptjs");
const { query, tx } = require("../db");
const config = require("../config");
const { generatePassword } = require("../util");

const ROUNDS = 12;
const MIN_PASSWORD = 8;
// Compared against for unknown emails so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", ROUNDS);

async function count() {
  const { rows } = await query("SELECT count(*)::int AS n FROM admins");
  return rows[0].n;
}

/** The very first admin becomes the owner, who manages the team. */
async function create({ name, email, password }) {
  const hash = await bcrypt.hash(password, ROUNDS);
  const { rows } = await query(
    `INSERT INTO admins (name, email, password_hash, role)
     VALUES ($1, lower($2), $3, CASE WHEN EXISTS (SELECT 1 FROM admins) THEN 'admin' ELSE 'owner' END)
     RETURNING id, name, email, role`,
    [name.trim(), email.trim(), hash]
  );
  // Quizzes imported before any admin existed belong to the first admin.
  if (rows[0].role === "owner") {
    await query("UPDATE quizzes SET created_by=$1 WHERE created_by IS NULL", [rows[0].id]);
  }
  return rows[0];
}

const PUBLIC_COLS = "id, name, email, role, created_at, last_login_at";

async function findById(id) {
  const { rows } = await query(`SELECT ${PUBLIC_COLS} FROM admins WHERE id=$1`, [id]);
  return rows[0] || null;
}

async function list() {
  const { rows } = await query(`SELECT ${PUBLIC_COLS} FROM admins ORDER BY role = 'owner' DESC, created_at`);
  return rows;
}

/** Returns the admin on success, null otherwise. Constant-ish time for unknown emails. */
async function authenticate(email, password) {
  const { rows } = await query("SELECT * FROM admins WHERE email=lower($1)", [String(email || "").trim()]);
  const admin = rows[0];
  const hash = admin?.password_hash || DUMMY_HASH;
  const ok = await bcrypt.compare(String(password || ""), hash);
  if (!admin || !ok) return null;
  await query("UPDATE admins SET last_login_at=now() WHERE id=$1", [admin.id]);
  return admin;
}

async function verifyPassword(id, password) {
  const { rows } = await query("SELECT password_hash FROM admins WHERE id=$1", [id]);
  return rows[0] ? bcrypt.compare(String(password || ""), rows[0].password_hash) : false;
}

/**
 * Sign an admin out everywhere except `keepSid` (the current browser). Sessions
 * live in the `sessions` table created by connect-pg-simple.
 */
async function endSessions(adminId, keepSid = null) {
  try {
    await query("DELETE FROM sessions WHERE sess->>'adminId' = $1::text AND sid IS DISTINCT FROM $2", [
      String(adminId),
      keepSid,
    ]);
  } catch (err) {
    if (err.code !== "42P01") throw err; // no sessions table yet = nobody to sign out
  }
}

async function setPassword(id, password) {
  const hash = await bcrypt.hash(password, ROUNDS);
  await query("UPDATE admins SET password_hash=$2 WHERE id=$1", [id, hash]);
}

async function updateProfile(id, { name, password }, currentSid) {
  if (name) await query("UPDATE admins SET name=$2 WHERE id=$1", [id, name.trim()]);
  if (password) {
    await setPassword(id, password);
    await endSessions(id, currentSid); // a changed password should lock out other browsers
  }
}

/** Owner action: give another admin a new random password and sign them out. */
async function resetPassword(id) {
  const password = generatePassword(12);
  await setPassword(id, password);
  await endSessions(id);
  return password;
}

/** Delete an admin, handing their quizzes to `transferTo` so nothing is orphaned. */
async function remove(id, transferTo) {
  await tx(async (client) => {
    await client.query("UPDATE quizzes SET created_by=$2 WHERE created_by=$1", [id, transferTo]);
    await client.query("DELETE FROM admins WHERE id=$1", [id]);
  });
  await endSessions(id);
}

async function seedFromEnv() {
  const { email, password, name } = config.admin;
  if (!email || !password) return;
  const { rows } = await query("SELECT 1 FROM admins WHERE email=lower($1)", [email]);
  if (rows.length) return;
  await create({ name, email, password });
  console.log(`Created admin account for ${email} from environment variables.`);
}

module.exports = {
  MIN_PASSWORD,
  count,
  create,
  findById,
  list,
  authenticate,
  verifyPassword,
  updateProfile,
  resetPassword,
  remove,
  seedFromEnv,
};
