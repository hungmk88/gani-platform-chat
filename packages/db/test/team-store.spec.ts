import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDbPool,
  createTeam,
  deleteTeam,
  listTeams,
  lockTeam,
  setTeamMembers,
  slugOf,
  teamUserIds,
  updateTeam,
  withTenant,
} from '../src/index.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// Teams of a workspace (A4, N160) through RLS: slugs made from the name and never reused, one default per workspace, nothing deleted.
const [A, B] = [uuidv7(), uuidv7()];
const seedUsers = new Map<string, string>();
const extra: string[] = [];
let admin: pg.Client;
let pool: pg.Pool;
let ws = '';
let owner = '';
const inA = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(pool, { orgId: A, workspaceIds: [] }, fn);
const make = (name: string, description: string | null = null) =>
  inA((tx) =>
    createTeam(tx, { id: uuidv7(), workspaceId: ws, name, description, createdBy: owner }),
  );

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 2 });
  for (const org of [A, B]) seedUsers.set(org, await seedTenant(admin, org));
  owner = seedUsers.get(A)!;
  ws = (await admin.query<{ id: string }>('SELECT id FROM workspaces WHERE org_id = $1', [A]))
    .rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
  for (const [org, user] of seedUsers) await cleanupTenant(admin, org, user);
  await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [extra]).catch(() => undefined);
  await admin.end();
});

describe('team-store', () => {
  it('makes a slug of the name, without accents, and a free one when it is taken', async () => {
    expect([
      slugOf('Đội Chăm sóc khách'),
      slugOf('  Bán sỉ!! '),
      slugOf('!!'),
      slugOf('x'),
    ]).toEqual(['doi-cham-soc-khach', 'ban-si', 'team', 'team']);
    const [one, two] = [await make('Bán sỉ', 'Khách sỉ miền Nam'), await make('Bán sỉ')];
    expect([one.slug, two.slug]).toEqual(['ban-si', 'ban-si-2']);
    expect(one).toMatchObject({
      workspaceId: ws,
      name: 'Bán sỉ',
      description: 'Khách sỉ miền Nam',
      isDefault: false,
      memberCount: 0,
    });
  });

  it('sets the people of a team, counts them, and lists a person their own teams only', async () => {
    const team = await make('Hỗ trợ');
    const other = await make('Kho');
    const person = uuidv7();
    extra.push(person);
    await admin.query(`INSERT INTO users (id, email, status) VALUES ($1, $2, 'active')`, [
      person,
      `${person}@example.test`,
    ]);
    await admin.query(
      `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'manager', 'active')`,
      [uuidv7(), A, person],
    );
    const set = (teamId: string, userIds: string[]) =>
      inA((tx) => setTeamMembers(tx, { teamId, userIds, actorUserId: owner, newId: uuidv7 }));
    expect(await set(team.id, [owner, person])).toEqual({ added: 2, removed: 0 });
    expect(await set(team.id, [person])).toEqual({ added: 0, removed: 1 });
    expect(await set(team.id, [person, owner])).toEqual({ added: 1, removed: 0 });
    expect(await set(other.id, [owner])).toEqual({ added: 1, removed: 0 });
    expect((await inA((tx) => lockTeam(tx, team.id)))?.memberCount).toBe(2);
    expect(await inA((tx) => teamUserIds(tx, team.id))).toEqual([owner, person].sort());
    const mine = await inA((tx) => listTeams(tx, { workspaceId: ws, memberUserId: person }));
    expect(mine.map((t) => t.id)).toEqual([team.id]);
  });

  it('keeps one default per workspace, ends a team with its memberships, and never reuses its slug', async () => {
    const [first, second] = [await make('Mặc định'), await make('Mặc định mới')];
    await inA((tx) =>
      updateTeam(tx, first, { isDefault: true, description: 'Nhận mọi hội thoại' }),
    );
    const now = await inA(async (tx) =>
      updateTeam(tx, (await lockTeam(tx, second.id))!, { isDefault: true }),
    );
    expect(now.isDefault).toBe(true);
    const defaults = await inA((tx) => listTeams(tx, { workspaceId: ws }));
    expect(defaults.filter((t) => t.isDefault).map((t) => t.id)).toEqual([second.id]);
    expect(defaults.find((t) => t.id === first.id)?.description).toBe('Nhận mọi hội thoại');

    await inA((tx) =>
      setTeamMembers(tx, { teamId: first.id, userIds: [owner], actorUserId: owner, newId: uuidv7 }),
    );
    await inA((tx) => deleteTeam(tx, first.id));
    expect(await inA((tx) => lockTeam(tx, first.id))).toBeNull();
    expect(await inA((tx) => teamUserIds(tx, first.id))).toEqual([]);
    expect((await make('Mặc định')).slug).toBe('mac-dinh-2');
  });

  it('refuses a second live default and a company-wide default in the database, and shows nothing of another org', async () => {
    const [x, y] = [await make('X một'), await make('Y một')];
    await admin.query('UPDATE teams SET is_default = false WHERE workspace_id = $1', [ws]);
    await admin.query('UPDATE teams SET is_default = true WHERE id = $1', [x.id]);
    expect(
      await sqlState(admin.query('UPDATE teams SET is_default = true WHERE id = $1', [y.id])),
    ).toBe('23505');
    expect(
      await sqlState(
        admin.query(
          `INSERT INTO teams (id, org_id, name, slug, is_default) VALUES ($1, $2, 'Toàn công ty', 'all-co', true)`,
          [uuidv7(), A],
        ),
      ),
    ).toBe('23514');
    const ofB = (await admin.query<{ id: string }>('SELECT id FROM teams WHERE org_id = $1', [B]))
      .rows[0]!.id;
    expect(await inA((tx) => lockTeam(tx, ofB))).toBeNull();
  });
});
