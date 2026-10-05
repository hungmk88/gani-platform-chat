import { getTableColumns, getTableName } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { authSchema } from '../src/index.js';
import { withClient } from './db.js';

// PR6c-2a (N79): the Drizzle tables Better Auth reads must match the database AND stay inside what auth_role may SELECT,
// otherwise a sign-in fails with 42501 or Better Auth reads a column it must not see.
const tables = Object.values(authSchema) as PgTable[];

describe('the Drizzle schema of Better Auth', () => {
  it.each(tables.map((table) => [getTableName(table), table] as const))(
    '%s: every column exists with its type, and auth_role may SELECT it',
    async (name, table) => {
      const columns = Object.values(getTableColumns(table));
      const { rows } = await withClient('migration', (c) =>
        c.query<{ name: string; type: string; ok: boolean }>(
          `SELECT a.attname AS name, format_type(a.atttypid, NULL) AS type,
                  has_column_privilege('auth_role', a.attrelid, a.attnum, 'SELECT') AS ok
           FROM pg_attribute a WHERE a.attrelid = ('public.' || $1)::regclass AND a.attnum > 0 AND NOT a.attisdropped`,
          [name],
        ),
      );
      const byName = new Map(rows.map((r) => [r.name, r]));
      for (const col of columns) {
        const real = byName.get(col.name);
        expect(real, `${name}.${col.name} is not in the database`).toBeDefined();
        expect(real?.ok, `auth_role may not SELECT ${name}.${col.name}`).toBe(true);
        expect(real?.type, `${name}.${col.name}`).toBe(col.getSQLType());
      }
    },
  );

  it('does not describe users.pending_password_since, which auth_role cannot read', () => {
    const names = Object.values(getTableColumns(authSchema.users)).map((c) => c.name);
    expect(names).not.toContain('pending_password_since');
  });

  it('maps email_verified_at to a boolean and back: NULL is false, a date is true', () => {
    const { emailVerified } = getTableColumns(authSchema.users);
    expect(emailVerified?.mapFromDriverValue(null)).toBe(false);
    expect(emailVerified?.mapFromDriverValue(new Date())).toBe(true);
    expect(emailVerified?.mapToDriverValue(false)).toBeNull();
    expect(emailVerified?.mapToDriverValue(true)).toBeInstanceOf(Date);
  });
});
