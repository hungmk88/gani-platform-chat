import { getTableColumns, getTableName } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { orgMembers, organizations, users, workspaceMembers, workspaces } from '../src/index.js';
import { withClient } from './db.js';

// ADR-002: the Drizzle schema must match the real tables, so they cannot drift. Add every new table here.
const tables: PgTable[] = [organizations, users, orgMembers, workspaces, workspaceMembers];

describe('Drizzle schema matches the database', () => {
  it.each(tables.map((table) => [getTableName(table), table] as const))(
    '%s',
    async (name, table) => {
      const fromDrizzle = Object.values(getTableColumns(table))
        .map((col) => ({ name: col.name, type: col.getSQLType(), nullable: !col.notNull }))
        .sort((x, y) => x.name.localeCompare(y.name));
      const fromDb = await withClient('migration', (c) =>
        c.query<{ name: string; type: string; nullable: boolean }>(
          `SELECT column_name AS name, data_type AS type, is_nullable = 'YES' AS nullable
         FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1
         ORDER BY column_name`,
          [name],
        ),
      );
      expect(fromDb.rows).toEqual(fromDrizzle);
    },
  );
});
