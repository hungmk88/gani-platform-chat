import { randomBytes } from 'node:crypto';

import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbPool, listChannels, lockTeam, setTeamChannels, withTenant } from '../src/index.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The team that answers a channel (A4, N161) through RLS: one team per channel, of the channel's own workspace; a channel given to
// another team moves; an unknown channel changes nothing.
const [A, B] = [uuidv7(), uuidv7()];
const seedUsers = new Map<string, string>();
let admin: pg.Client;
let pool: pg.Pool;
const [ws, other] = [
  { id: '', team: '', seed: '' },
  { id: uuidv7(), team: uuidv7(), seed: uuidv7() },
];
let [second, gone, ofB] = ['', '', ''];
const inA = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(pool, { orgId: A, workspaceIds: [] }, fn);
// prettier-ignore
const channel = async (org: string, workspace: string, name: string, deleted = false) => {
  const id = uuidv7();
  await admin.query(
    `INSERT INTO channel_accounts (id, org_id, workspace_id, type, external_account_id, display_name, deleted_at)
     VALUES ($1, $2, $3, 'webchat', $4, $5, CASE WHEN $6 THEN now() END)`,
    [id, org, workspace, `ext-${randomBytes(6).toString('hex')}`, name, deleted],
  );
  return id;
};
const set = (teamId: string, channelIds: string[], workspaceId = ws.id) =>
  inA((tx) => setTeamChannels(tx, { teamId, workspaceId, channelIds }));
const channelsOf = async (teamId: string) => (await inA((tx) => lockTeam(tx, teamId)))?.channelIds;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 2 });
  for (const org of [A, B]) seedUsers.set(org, await seedTenant(admin, org));
  const seeded = await admin.query<{ ws: string; team: string; ch: string }>(
    `SELECT w.id AS ws, t.id AS team, c.id AS ch FROM workspaces w JOIN teams t ON t.workspace_id = w.id
     JOIN channel_accounts c ON c.workspace_id = w.id WHERE w.org_id = $1`,
    [A],
  );
  Object.assign(ws, {
    id: seeded.rows[0]!.ws,
    team: seeded.rows[0]!.team,
    seed: seeded.rows[0]!.ch,
  });
  await admin.query(
    `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ws-2', 'W2', 'service')`,
    [other.id, A],
  );
  await admin.query(
    `INSERT INTO teams (id, org_id, workspace_id, name, slug) VALUES ($1, $2, $3, 'T2', 'tm-2')`,
    [other.team, A, other.id],
  );
  other.seed = await channel(A, other.id, 'Khác');
  second = await channel(A, ws.id, 'Bán sỉ');
  gone = await channel(A, ws.id, 'Đã gỡ', true);
  ofB = (
    await admin.query<{ id: string }>('SELECT id FROM channel_accounts WHERE org_id = $1', [B])
  ).rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
  for (const [org, user] of seedUsers) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('channel-store', () => {
  it('lists the live channels of a workspace by name, without a team yet, and nothing of another one', async () => {
    expect(await inA((tx) => listChannels(tx, ws.id))).toEqual([
      { id: second, type: 'webchat', displayName: 'Bán sỉ', status: 'disconnected', teamId: null },
      { id: ws.seed, type: 'zalo_oa', displayName: 'OA', status: 'disconnected', teamId: null },
    ]);
    expect((await inA((tx) => listChannels(tx, other.id))).map((c) => c.id)).toEqual([other.seed]);
    expect(await channelsOf(ws.team)).toEqual([]);
  });

  it('gives a team its channels, moves a channel of another team, and takes back the ones left out', async () => {
    const team2 = uuidv7();
    await admin.query(
      `INSERT INTO teams (id, org_id, workspace_id, name, slug) VALUES ($1, $2, $3, 'T3', 'tm-3')`,
      [team2, A, ws.id],
    );
    expect(await set(ws.team, [second, ws.seed])).toEqual({ added: 2, removed: 0, moved: 0 });
    expect(await channelsOf(ws.team)).toEqual([second, ws.seed].sort());
    expect(await set(ws.team, [ws.seed, second])).toEqual({ added: 0, removed: 0, moved: 0 });
    expect(await set(team2, [second])).toEqual({ added: 1, removed: 0, moved: 1 });
    expect([await channelsOf(ws.team), await channelsOf(team2)]).toEqual([[ws.seed], [second]]);
    expect(await set(ws.team, [])).toEqual({ added: 0, removed: 1, moved: 0 });
    expect(await channelsOf(ws.team)).toEqual([]);
    const listed = await inA((tx) => listChannels(tx, ws.id));
    expect(listed.map((c) => [c.id, c.teamId])).toEqual([
      [second, team2],
      [ws.seed, null],
    ]);
  });

  it('changes nothing for a channel of another workspace, a deleted one, one of another org or no channel at all', async () => {
    for (const id of [other.seed, gone, ofB, uuidv7()])
      expect(await set(ws.team, [ws.seed, id]), id).toBeNull();
    expect(await channelsOf(ws.team)).toEqual([]);
  });

  it('refuses in the database a team of another workspace', async () => {
    expect(
      await sqlState(
        admin.query('UPDATE channel_accounts SET team_id = $1 WHERE id = $2', [
          other.team,
          ws.seed,
        ]),
      ),
    ).toBe('23503');
  });
});
