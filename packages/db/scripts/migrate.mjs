// Migration runner: applies packages/db/migrations/*.sql in name order, as migration_role.
// Usage: DATABASE_URL_MIGRATION=... node scripts/migrate.mjs   (roles must exist: infra/db/bootstrap-roles.sql)
// Each file runs in one transaction. Applied files are tracked with a checksum; editing an applied file is an error.
import { createHash } from 'node:crypto';
import console from 'node:console';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

import pg from 'pg';

import { lintMigrations } from '../lint/lint-migrations.mjs';

const ROLES = ['app_role', 'auth_role', 'migration_role', 'support_role'];
const LOCK_KEY = 7_265_001; // arbitrary constant: one runner at a time
const defaultDir = fileURLToPath(new URL('../migrations/', import.meta.url));

const checksum = (sql) => createHash('sha256').update(sql).digest('hex');

/** Apply pending migrations. Returns the names applied. Throws on lint errors, drift or SQL errors. */
export async function migrate({
  connectionString,
  dir = defaultDir,
  table = 'public.schema_migrations',
}) {
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
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
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
    for (const [id, sql] of contents) {
      if (done.has(id)) continue;
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(`INSERT INTO ${table} (id, checksum) VALUES ($1, $2)`, [
          id,
          checksum(sql),
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${id} failed and was rolled back: ${error.message}`, {
          cause: error,
        });
      }
      applied.push(id);
    }
    return applied;
  } finally {
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
