// Migration runner: applies packages/db/migrations/*.sql in name order, as migration_role.
// Usage: DATABASE_URL_MIGRATION=... node scripts/migrate.mjs   (roles must exist: infra/db/bootstrap-roles.sql)
// Each file runs in one transaction, with a lock_timeout: a file that cannot get its locks in time is rolled back and tried again
// (review DB-03), so a migration never queues behind a long transaction while it blocks every query of the table. A file whose leading
// comments say `-- migrate:no-transaction` holds one statement (lint MIG-NOTXN) and runs outside a transaction, for
// CREATE INDEX CONCURRENTLY; it gets no lock_timeout, because a CONCURRENTLY build cut short leaves an INVALID index behind.
// Applied files are tracked with a checksum; editing an applied file is an error.
import { createHash } from 'node:crypto';
import console from 'node:console';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

import pg from 'pg';

import { isNoTransaction, lintMigrations } from '../lint/lint-migrations.mjs';

const ROLES = ['app_role', 'auth_role', 'migration_role', 'support_role'];
const LOCK_KEY = 7_265_001; // arbitrary constant: one runner at a time
const defaultDir = fileURLToPath(new URL('../migrations/', import.meta.url));

const checksum = (sql) => createHash('sha256').update(sql).digest('hex');

/** The same 5 s as DEFAULT_LOCK_TIMEOUT_MS of src/pool.ts. */
export const LOCK_TIMEOUT_MS = 5_000;
export const LOCK_ATTEMPTS = 3;
/** Wait before the 2nd attempt; doubled before each later one (2 s, 4 s). */
export const RETRY_DELAY_MS = 2_000;
const LOCK_NOT_AVAILABLE = '55P03';

/** Apply pending migrations. Returns the names applied. Throws on lint errors, drift or SQL errors. */
export async function migrate({
  connectionString,
  dir = defaultDir,
  table = 'public.schema_migrations',
  lockTimeoutMs = LOCK_TIMEOUT_MS,
  attempts = LOCK_ATTEMPTS,
  retryDelayMs = RETRY_DELAY_MS,
}) {
  if (!Number.isInteger(lockTimeoutMs) || lockTimeoutMs < 1)
    throw new Error('invalid lockTimeoutMs');
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error('invalid attempts');
  // `table` is interpolated into SQL: accept only a plain (schema.)name, never caller-supplied text.
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/.test(table))
    throw new Error('invalid tracking table name');
  const lint = lintMigrations(dir);
  if (lint.errors.length) {
    const lines = lint.errors.map((f) => `${f.file}:${f.line} ${f.rule} ${f.message}`);
    throw new Error(`migration lint failed, nothing applied:\n${lines.join('\n')}`);
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const client = new pg.Client({ connectionString });
  await client.connect();
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    locked = true;
    const roles = await client.query('SELECT rolname FROM pg_roles WHERE rolname = ANY($1)', [
      ROLES,
    ]);
    if (roles.rowCount !== ROLES.length) {
      throw new Error(
        'DB roles are missing: run infra/db/bootstrap-roles.sql as a superuser first',
      );
    }
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${table} (id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const done = new Map(
      (await client.query(`SELECT id, checksum FROM ${table}`)).rows.map((r) => [r.id, r.checksum]),
    );
    const contents = new Map(
      files.map((f) => [f, readFileSync(join(dir, f), 'utf8').replaceAll('\r\n', '\n')]),
    );
    for (const [id, sum] of done) {
      if (!contents.has(id)) throw new Error(`applied migration ${id} is missing from ${dir}`);
      if (checksum(contents.get(id)) !== sum)
        throw new Error(`applied migration ${id} was modified; add a new migration instead`);
    }
    const applied = [];
    const record = (id, sql) =>
      client.query(`INSERT INTO ${table} (id, checksum) VALUES ($1, $2)`, [id, checksum(sql)]);
    for (const [id, sql] of contents) {
      if (done.has(id)) continue;
      if (isNoTransaction(sql)) {
        try {
          await client.query(sql);
        } catch (error) {
          throw new Error(
            `migration ${id} (no-transaction) failed and nothing was recorded: ${error.message}. A CREATE INDEX CONCURRENTLY ` +
              'that failed leaves an INVALID index: find it in pg_index (indisvalid = false), DROP INDEX CONCURRENTLY it, run again.',
            { cause: error },
          );
        }
        // A file is recorded only when no index is left INVALID (by this run or a failed earlier one): MIG-NOTXN already forbids the
        // IF NOT EXISTS that would skip one, this catches whatever else gets past. A CONCURRENTLY build running in another session at
        // this moment also shows as INVALID: the runner then stops, and running it again later is enough.
        const invalid = await client.query(
          "SELECT indexrelid::regclass::text AS name FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT i.indisvalid AND n.nspname NOT IN ('pg_catalog', 'information_schema') ORDER BY 1",
        );
        if (invalid.rowCount > 0)
          throw new Error(
            `migration ${id} (no-transaction) ran, but INVALID index(es) exist: ${invalid.rows.map((r) => r.name).join(', ')}; ` +
              'nothing was recorded: DROP INDEX CONCURRENTLY them, run again.',
          );
        await record(id, sql);
        applied.push(id);
        continue;
      }
      for (let attempt = 1; ; attempt++) {
        try {
          await client.query('BEGIN');
          // Interpolated, not bound: SET takes no parameters. lockTimeoutMs is checked to be a whole number above.
          await client.query(`SET LOCAL lock_timeout = ${lockTimeoutMs}`);
          await client.query(sql);
          await record(id, sql);
          await client.query('COMMIT');
          break;
        } catch (error) {
          await client.query('ROLLBACK');
          if (error?.code === LOCK_NOT_AVAILABLE && attempt < attempts) {
            await sleep(retryDelayMs * 2 ** (attempt - 1));
            continue;
          }
          const why =
            error?.code === LOCK_NOT_AVAILABLE
              ? `lock not available after ${attempt} attempt(s)`
              : error.message;
          throw new Error(`migration ${id} failed and was rolled back: ${why}`, { cause: error });
        }
      }
      applied.push(id);
    }
    return applied;
  } finally {
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    } catch {
      // Closing the connection releases the session lock anyway; never hide the original error.
    }
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const connectionString = process.env.DATABASE_URL_MIGRATION;
  if (!connectionString) {
    console.error('migrate: DATABASE_URL_MIGRATION is not set');
    process.exitCode = 2;
  } else {
    migrate({ connectionString })
      .then((applied) => console.log(`migrate: applied ${applied.length} migration(s)`, ...applied))
      .catch((error) => {
        console.error(`migrate: ${error.message}`);
        process.exitCode = 1;
      });
  }
}
