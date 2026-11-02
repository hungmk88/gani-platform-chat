import { DEFAULT_WORKING_WEEK, uuidv7, type WorkingWeek } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDayOff,
  createDbPool,
  deleteDayOff,
  HolidayInPastError,
  HolidayOverlapError,
  listDaysOff,
  lockDayOff,
  lockWorkspace,
  readWorkingWeek,
  setWorkingWeek,
  updateDayOff,
  withTenant,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The working hours and days off of a workspace (C10-2b, N192) through RLS: the default week until one is set, one row per weekday,
// days off that never overlap nor end in the past (workspace time zone), nothing deleted.
const [A, B] = [uuidv7(), uuidv7()];
const seedUsers = new Map<string, string>();
let admin: pg.Client;
let pool: pg.Pool;
let ws = '';
const inA = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(pool, { orgId: A, workspaceIds: [ws] }, fn);
const failure = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );
/** The date `n` days from today in the workspace's time zone, as the store reckons "today". */
const day = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toLocaleDateString('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
  });
const addDayOff = (name: string, startsOn: string, endsOn: string) =>
  inA(async (tx) => {
    await lockWorkspace(tx, ws);
    return createDayOff(tx, { id: uuidv7(), workspaceId: ws, name, startsOn, endsOn });
  });

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 2 });
  for (const org of [A, B]) seedUsers.set(org, await seedTenant(admin, org));
  ws = (await admin.query<{ id: string }>('SELECT id FROM workspaces WHERE org_id = $1', [A]))
    .rows[0]!.id;
  // The seed rows of fixtures.ts are out of the way of these tests.
  await admin.query('DELETE FROM workspace_hours WHERE org_id = $1', [A]);
  await admin.query('UPDATE workspace_holidays SET deleted_at = now() WHERE org_id = $1', [A]);
  await admin.query(`UPDATE workspaces SET timezone = 'Asia/Ho_Chi_Minh' WHERE id = $1`, [ws]);
});

afterAll(async () => {
  await pool.end();
  for (const [org, user] of seedUsers) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('business-hours-store', () => {
  it('reads the default week until one is set, then the set one, one row per weekday', async () => {
    expect(await inA((tx) => readWorkingWeek(tx, ws))).toEqual({
      timezone: 'Asia/Ho_Chi_Minh',
      week: DEFAULT_WORKING_WEEK,
      isDefault: true,
    });
    const open = {
      opensAt: '08:00:00',
      closesAt: '17:00:00',
      breakStartsAt: null,
      breakEndsAt: null,
    };
    const week: WorkingWeek = [
      { ...open, breakStartsAt: '12:00:00', breakEndsAt: '13:00:00' },
      open,
      open,
      open,
      open,
      null,
      null,
    ];
    const set = (w: WorkingWeek) =>
      inA(async (tx) => {
        await lockWorkspace(tx, ws);
        await setWorkingWeek(tx, ws, w);
      });
    await set(DEFAULT_WORKING_WEEK);
    await set(week);
    expect(await inA((tx) => readWorkingWeek(tx, ws))).toEqual({
      timezone: 'Asia/Ho_Chi_Minh',
      week,
      isDefault: false,
    });
    const rows = await admin.query('SELECT 1 FROM workspace_hours WHERE workspace_id = $1', [ws]);
    expect(rows.rowCount).toBe(7);
    expect(
      await withTenant(pool, { orgId: B, workspaceIds: [] }, (tx) => readWorkingWeek(tx, ws)),
    ).toBeNull();
  });

  it('adds days off that neither overlap a live one nor end in the past, and lists them by start', async () => {
    const tet = await addDayOff('Tết', day(30), day(36));
    await addDayOff('Một ngày', day(10), day(10));
    expect(await failure(addDayOff('Chồng', day(36), day(40)))).toBeInstanceOf(HolidayOverlapError);
    expect(await failure(addDayOff('Đã qua', day(-3), day(-1)))).toBeInstanceOf(HolidayInPastError);
    expect((await addDayOff('Hôm nay', day(0), day(0))).name).toBe('Hôm nay');
    const names = (await inA((tx) => listDaysOff(tx, ws, day(5)))).map((d) => d.name);
    expect(names).toEqual(['Một ngày', 'Tết']);
    expect(tet).toMatchObject({ startsOn: day(30), endsOn: day(36) });
  });

  it('changes a day off with the same checks, itself aside, and ends one so its dates are free again', async () => {
    const [a, b] = [await addDayOff('A', day(50), day(51)), await addDayOff('B', day(53), day(54))];
    const change = (id: string, c: { name?: string; startsOn?: string; endsOn?: string }) =>
      inA(async (tx) => {
        await lockWorkspace(tx, ws);
        const current = await lockDayOff(tx, ws, id);
        return updateDayOff(tx, ws, current!, c);
      });
    expect(await change(a.id, { endsOn: day(52), name: 'A dài' })).toMatchObject({
      name: 'A dài',
      startsOn: day(50),
      endsOn: day(52),
    });
    expect(await failure(change(a.id, { endsOn: day(53) }))).toBeInstanceOf(HolidayOverlapError);
    expect(await failure(change(a.id, { startsOn: day(-9), endsOn: day(-8) }))).toBeInstanceOf(
      HolidayInPastError,
    );
    await inA(async (tx) => {
      await lockDayOff(tx, ws, b.id);
      await deleteDayOff(tx, b.id);
    });
    expect(await inA((tx) => lockDayOff(tx, ws, b.id))).toBeNull();
    expect((await change(a.id, { endsOn: day(54) })).endsOn).toBe(day(54));
  });
});
