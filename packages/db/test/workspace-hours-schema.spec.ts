import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asApp } from './as-app.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The tables of the working hours and days off (C10-1, Q7, U44, N192): what the database refuses on its own, before any store.
// Cross-organisation reads and "no DELETE" (case 11) are in rls-all-tables.spec, the UPDATE columns of app_role in grants.spec.
const [org, other] = [uuidv7(), uuidv7()];
const users: string[] = [];
let [ws, otherWs] = ['', ''];
let admin: pg.Client;
let app: pg.Client;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  app = new pg.Client({ connectionString: url('app') });
  await Promise.all([admin.connect(), app.connect()]);
  for (const o of [org, other]) users.push(await seedTenant(admin, o));
  const one = async (o: string) =>
    (await admin.query<{ id: string }>('SELECT id FROM workspaces WHERE org_id = $1', [o])).rows[0]
      ?.id as string;
  [ws, otherWs] = [await one(org), await one(other)];
});

afterAll(async () => {
  await app.end();
  for (const [i, o] of [org, other].entries()) await cleanupTenant(admin, o, users[i] as string);
  await admin.end();
});

/** A day of the week of `workspace`; null hours mean closed. Resolves to the SQLSTATE, or undefined. */
const day = (weekday: number, hours: (string | null)[], workspace = ws) =>
  sqlState(
    admin.query(
      `INSERT INTO workspace_hours (id, org_id, workspace_id, weekday, opens_at, closes_at, break_starts_at, break_ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [uuidv7(), org, workspace, weekday, ...hours],
    ),
  );
const off = (name: string, startsOn: string, endsOn: string, workspace = ws) =>
  sqlState(
    admin.query(
      'INSERT INTO workspace_holidays (id, org_id, workspace_id, name, starts_on, ends_on) VALUES ($1, $2, $3, $4, $5, $6)',
      [uuidv7(), org, workspace, name, startsOn, endsOn],
    ),
  );

describe('workspace_hours', () => {
  it('takes an open day with or without a break inside it, or a closed day, once per ISO weekday', async () => {
    expect(await day(1, ['08:00', '18:00', '12:00', '13:00'])).toBeUndefined();
    expect(await day(2, ['08:00', '18:00', null, null])).toBeUndefined();
    expect(await day(7, [null, null, null, null])).toBeUndefined();
    expect(await day(1, ['09:00', '17:00', null, null])).toBe('23505');
    for (const [weekday, hours] of [
      [0, ['08:00', '18:00', null, null]],
      [8, ['08:00', '18:00', null, null]],
      [3, ['18:00', '08:00', null, null]],
      [3, ['08:00', null, null, null]],
      [3, ['08:00', '18:00', '12:00', null]],
      [3, ['08:00', '18:00', '13:00', '12:00']],
      [3, ['08:00', '18:00', '07:00', '09:00']],
      [3, [null, null, '12:00', '13:00']],
    ] as const)
      expect(await day(weekday, [...hours]), JSON.stringify([weekday, hours])).toBe('23514');
    expect(await day(4, ['08:00', '18:00', null, null], otherWs)).toBe('23503');
  });
});

describe('workspace_holidays', () => {
  it('takes one day or a range with a trimmed NFC name, inside its organisation', async () => {
    expect(await off('Quốc khánh', '2026-09-02', '2026-09-02')).toBeUndefined();
    expect(await off('Tết', '2027-02-04', '2027-02-10')).toBeUndefined();
    expect(await off('Ngược', '2027-02-10', '2027-02-04')).toBe('23514');
    for (const bad of ['', ' Tết', 'x'.repeat(101), 'Tết'])
      expect(await off(bad, '2027-01-01', '2027-01-01'), JSON.stringify(bad)).toBe('23514');
    expect(await off('Khác', '2027-01-01', '2027-01-01', otherWs)).toBe('23503');
  });

  it('lets app_role add, change and switch off a day off, never move it nor delete it', async () => {
    const write = (sql: string, params: unknown[] = []) =>
      asApp(app, org, [], () => sqlState(app.query(sql, params)));
    expect(
      await write(
        'INSERT INTO workspace_holidays (id, org_id, workspace_id, name, starts_on, ends_on) VALUES ($1, $2, $3, $4, $5, $6)',
        [uuidv7(), org, ws, 'Giỗ Tổ', '2027-04-16', '2027-04-16'],
      ),
    ).toBeUndefined();
    expect(
      await write(`UPDATE workspace_holidays SET deleted_at = now() WHERE name = 'Giỗ Tổ'`),
    ).toBe(undefined);
    expect(await write('UPDATE workspace_holidays SET workspace_id = workspace_id')).toBe('42501');
    expect(await write('UPDATE workspace_hours SET weekday = weekday')).toBe('42501');
    expect(await write('DELETE FROM workspace_holidays')).toBe('42501');
    expect(await write('DELETE FROM workspace_hours')).toBe('42501');
  });
});
