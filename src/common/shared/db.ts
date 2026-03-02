import { Pool, QueryResult, QueryResultRow } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
});

/**
 * Execute a parameterised query. SQL must use $1..$n placeholders only.
 * Dynamic table/column names are PROHIBITED — use a lint rule to enforce.
 */
export async function query<T extends QueryResultRow>(
  sql: string,
  params: unknown[],
): Promise<T[]> {
  const start = Date.now();
  const result: QueryResult<T> = await pool.query<T>(sql, params);
  const duration = Date.now() - start;

  if (duration > 1_000) {
    console.warn({ msg: 'slow_query', duration, sql: sql.slice(0, 120) });
  }

  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  sql: string,
  params: unknown[],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function transaction<T>(fn: (client: typeof pool) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client as unknown as typeof pool);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export { pool };
