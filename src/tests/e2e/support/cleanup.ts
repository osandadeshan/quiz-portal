import fs from "fs";
import path from "path";
import { Client } from "pg";
import { PORTS, MAILBOX_URL, OUTPUT_DIR } from "./env";

/**
 * Leaves the app exactly as it was before the E2E run, whether tests passed,
 * failed or never ran.
 *
 *   global-setup.ts    → snapshot()  : records every table's contents (as a fingerprint),
 *                                      the row ids that existed, the admin rows and the inbox.
 *   global-teardown.ts → restore()   : deletes every quiz (with its questions, options,
 *                                      invitations and answers), admin and session the run
 *                                      created, puts changed admin rows back (e.g. last sign-in
 *                                      time), resets id sequences, empties the inbox of the
 *                                      run's emails, then verifies every table matches the
 *                                      snapshot and fails the run if it doesn't.
 *
 * Playwright starts the webServer before global setup and stops it after global
 * teardown, so the database and Mailpit are up for both.
 */

export const DATABASE_URL = `postgres://quiz:quiz@127.0.0.1:${PORTS.postgres}/quiz`;
const SNAPSHOT_PATH = path.join(OUTPUT_DIR, "baseline-snapshot.json");

/** Guard: this must only ever touch the throwaway E2E database. */
function assertThrowawayDatabase() {
  if (PORTS.postgres === 5433 || PORTS.postgres === 5432) {
    throw new Error(`Refusing to clean up port ${PORTS.postgres}: that looks like a real database, not the E2E one.`);
  }
}

type Snapshot = {
  takenAt: string;
  fingerprints: Record<string, { rows: number; md5: string | null }>;
  ids: Record<string, (number | string)[]>;
  admins: Record<string, unknown>[];
  sequences: Record<string, number | null>;
  mailIds: string[];
};

/** Tables whose rows the run can add; child tables are removed by ON DELETE CASCADE. */
const OWNED = { quizzes: "id", admins: "id", sessions: "sid" } as const;

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  assertThrowawayDatabase();
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

async function tables(db: Client): Promise<string[]> {
  const r = await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
  return r.rows.map((x) => x.tablename as string);
}

/** Row count plus an order-independent hash of every row's full contents. */
async function fingerprints(db: Client) {
  const out: Snapshot["fingerprints"] = {};
  for (const t of await tables(db)) {
    const r = await db.query(
      `SELECT count(*)::int AS rows, md5(string_agg(x::text, '|' ORDER BY x::text)) AS md5 FROM ${quoteIdent(t)} x`
    );
    out[t] = { rows: r.rows[0].rows, md5: r.rows[0].md5 };
  }
  return out;
}

async function serialSequences(db: Client): Promise<Record<string, number | null>> {
  const r = await db.query(
    `SELECT c.relname AS table, a.attname AS col, pg_get_serial_sequence(quote_ident(c.relname), a.attname) AS seq
       FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
        AND pg_get_serial_sequence(quote_ident(c.relname), a.attname) IS NOT NULL`
  );
  const out: Record<string, number | null> = {};
  for (const row of r.rows) {
    const s = await db.query(`SELECT last_value::int AS v, is_called FROM ${row.seq}`);
    out[`${row.table}.${row.col}|${row.seq}`] = s.rows[0].is_called ? s.rows[0].v : null;
  }
  return out;
}

const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

type MailList = { total: number; messages: { ID: string }[] };
async function mailIds(): Promise<string[]> {
  const res = await fetch(`${MAILBOX_URL}/api/v1/messages?limit=10000`);
  if (!res.ok) throw new Error(`Mailpit API returned ${res.status}`);
  const body = (await res.json()) as MailList;
  return body.messages.map((m) => m.ID);
}

export async function snapshot(): Promise<Snapshot> {
  const snap = await withDb(async (db) => {
    const ids: Snapshot["ids"] = {};
    const existing = await tables(db);
    for (const [t, col] of Object.entries(OWNED)) {
      // The session store creates "sessions" on first use, so it may not exist yet.
      ids[t] = existing.includes(t) ? (await db.query(`SELECT ${col} AS id FROM ${t} ORDER BY 1`)).rows.map((r) => r.id) : [];
    }
    return {
      takenAt: new Date().toISOString(),
      fingerprints: await fingerprints(db),
      ids,
      // to_jsonb keeps timestamps at full (microsecond) precision; JS Dates would round them.
      admins: (await db.query(`SELECT to_jsonb(a) AS row FROM admins a ORDER BY id`)).rows.map((r) => r.row),
      sequences: await serialSequences(db),
    };
  });
  const full: Snapshot = { ...snap, mailIds: await mailIds() };
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(full, null, 2));
  return full;
}

export type CleanupReport = { removed: Record<string, number>; emailsRemoved: number; mismatches: string[] };

export async function restore(): Promise<CleanupReport> {
  if (!fs.existsSync(SNAPSHOT_PATH)) throw new Error(`No baseline snapshot at ${SNAPSHOT_PATH}; global setup didn't run.`);
  const base = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")) as Snapshot;
  const removed: Record<string, number> = {};

  const mismatches = await withDb(async (db) => {
    await db.query("BEGIN");
    try {
      // Count what the run left behind (for the report) before cascading deletes.
      for (const t of ["questions", "options", "invitations", "answers"]) {
        const now = base.fingerprints[t] ? (await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n : 0;
        removed[t] = now - (base.fingerprints[t]?.rows ?? 0);
      }
      // Quizzes first (cascades to questions → options, invitations → answers), then
      // sessions and admins the run created.
      const existing = await tables(db);
      for (const t of ["quizzes", "sessions", "admins"] as const) {
        if (!existing.includes(t)) continue;
        const col = OWNED[t];
        const r = await db.query(`DELETE FROM ${t} WHERE NOT (${col} = ANY($1))`, [base.ids[t]]);
        removed[t] = r.rowCount ?? 0;
      }
      // Put changed admin rows back exactly (last sign-in time, name, password…).
      for (const row of base.admins) {
        const cols = Object.keys(row).filter((c) => c !== "id").map(quoteIdent);
        await db.query(
          `UPDATE admins SET (${cols.join(", ")}) = (SELECT ${cols.map((c) => `r.${c}`).join(", ")}
             FROM jsonb_populate_record(NULL::admins, $1::jsonb) r) WHERE id = ($1::jsonb->>'id')::int`,
          [JSON.stringify(row)]
        );
      }
      // Id counters back to where they were, so the next quiz gets the same id as before.
      for (const [key, last] of Object.entries(base.sequences)) {
        const seq = key.split("|")[1];
        if (last === null) await db.query(`SELECT setval($1, 1, false)`, [seq]);
        else await db.query(`SELECT setval($1, $2, true)`, [seq, last]);
      }
      await db.query("COMMIT");
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    }

    const after = await fingerprints(db);
    const problems: string[] = [];
    for (const t of new Set([...Object.keys(base.fingerprints), ...Object.keys(after)])) {
      const b = base.fingerprints[t];
      const a = after[t];
      // A table the app created lazily during the run (the session store's "sessions")
      // can't be dropped while the app is running; it must at least be empty again.
      if (!b) { if (a.rows !== 0) problems.push(`table "${t}" was created during the run and still has ${a.rows} rows`); }
      else if (!a) problems.push(`table "${t}" is missing after cleanup`);
      else if (a.rows !== b.rows || a.md5 !== b.md5) problems.push(`table "${t}": ${a.rows} rows after cleanup, ${b.rows} before (contents differ)`);
    }
    const seqAfter = await serialSequences(db);
    for (const [k, v] of Object.entries(base.sequences)) {
      if (seqAfter[k] !== v) problems.push(`sequence ${k.split("|")[1]} is ${seqAfter[k]}, was ${v}`);
    }
    return problems;
  });

  // Emails the run sent.
  const created = (await mailIds()).filter((id) => !base.mailIds.includes(id));
  if (created.length) {
    const res = await fetch(`${MAILBOX_URL}/api/v1/messages`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ IDs: created }),
    });
    if (!res.ok) mismatches.push(`Mailpit refused to delete ${created.length} emails (${res.status})`);
  }
  const mailAfter = await mailIds();
  if (mailAfter.length !== base.mailIds.length || mailAfter.some((id) => !base.mailIds.includes(id))) {
    mismatches.push(`inbox has ${mailAfter.length} emails after cleanup, had ${base.mailIds.length} before`);
  }

  return { removed, emailsRemoved: created.length, mismatches };
}
