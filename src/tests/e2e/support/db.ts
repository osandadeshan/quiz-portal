import { Client } from "pg";
import { DATABASE_URL } from "./cleanup";

/**
 * Read-only queries against the throwaway E2E database, for API-test assertions
 * that the HTTP responses alone can't prove (stored score, role, row counts).
 * Never write through this; the app is the only writer.
 */
export async function dbQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (!/^\s*select\b/i.test(sql)) throw new Error("dbQuery is read-only: SELECT statements only");
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(sql, params)).rows as T[];
  } finally {
    await db.end();
  }
}

export async function dbValue<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  const rows = await dbQuery(sql, params);
  return rows[0] ? (Object.values(rows[0])[0] as T) : undefined;
}
