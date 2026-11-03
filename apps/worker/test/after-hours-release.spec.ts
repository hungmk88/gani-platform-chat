import { ConversationStateMachine } from '@gani/conversations';
import { uuidv7 } from '@gani/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbReleaseStore } from '../src/after-hours/db-store.js';
import { AfterHoursReleaseJob } from '../src/after-hours/release-job.js';
import { adminPool, appPool, seedOrg, type Pool } from './db.js';

// The release of the conversations held outside business hours on PostgreSQL as app_role (C10-4b, T08, N193): a workspace open all
// day releases its held conversations to the queue through the state machine (state, hold, history, outbox); a workspace that never
// opens keeps them; another organisation is never touched. The job's pass is cut down to the organisations of this spec.
let admin: Pool;
let app: Pool;
const orgs: string[] = [];
const [open, closed, otherWs] = [uuidv7(), uuidv7(), uuidv7()];
const log = { info: () => undefined, warn: () => undefined, error: () => undefined };
const rows = async <T>(sql: string, params: unknown[]) =>
  (await admin.query(sql, params)).rows as T[];

async function workspace(org: string, id: string, opens: string | null, closes: string | null) {
  await admin.query(
    `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, $3, 'W', 'service')`,
    [id, org, `w-${id}`],
  );
  for (let weekday = 1; weekday <= 7; weekday++)
    await admin.query(
      'INSERT INTO workspace_hours (id, org_id, workspace_id, weekday, opens_at, closes_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [uuidv7(), org, id, weekday, opens, closes],
    );
}
async function held(org: string, ws: string): Promise<string> {
  const id = uuidv7();
  await admin.query(
    `INSERT INTO conversations (id, org_id, workspace_id, state, after_hours_hold, priority) VALUES ($1, $2, $3, 'BOT_ACTIVE', true, 'high')`,
    [id, org, ws],
  );
  return id;
}
const stateOf = async (id: string) =>
  (
    await rows<{ state: string; hold: boolean; priority: string }>(
      'SELECT state, after_hours_hold AS hold, priority FROM conversations WHERE id = $1',
      [id],
    )
  )[0];

beforeAll(async () => {
  [admin, app] = [adminPool(), appPool()];
  orgs.push(await seedOrg(admin), await seedOrg(admin));
  await workspace(orgs[0]!, open, '00:00', '24:00');
  await workspace(orgs[0]!, closed, null, null);
  await workspace(orgs[1]!, otherWs, null, null);
});

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe('the after-hours release', () => {
  it('hands the held conversations of an open workspace to the queue (T08), keeps those of a closed one, and leaves other organisations alone', async () => {
    const [a, b, keep, other] = [
      await held(orgs[0]!, open),
      await held(orgs[0]!, open),
      await held(orgs[0]!, closed),
      await held(orgs[1]!, otherWs),
    ];
    const store = createDbReleaseStore({ pool: app, fsm: new ConversationStateMachine() });
    const mine = {
      ...store,
      heldOrgs: async (limit: number) =>
        (await store.heldOrgs(limit)).filter((o) => orgs.includes(o)),
    };
    expect((await mine.heldOrgs(1000)).sort()).toEqual([...orgs].sort());
    const job = new AfterHoursReleaseJob({
      store: mine,
      log,
      settings: { pollMs: 60_000, orgsPerTick: 1000, orgParallel: 1, batch: 1 },
      shutdownMs: 1_000,
    });
    // A batch of one: the first pass releases one and asks again at once, the second the other, the third finds nothing open.
    expect(await job.tick()).toBe(true);
    await job.tick();
    expect(await job.tick()).toBe(false);
    for (const id of [a, b])
      expect(await stateOf(id)).toEqual({
        state: 'HUMAN_WAITING_Q',
        hold: false,
        priority: 'high',
      });
    expect(
      await rows(
        "SELECT e.detail->>'transition' AS transition, e.actor_kind AS actor, e.from_hold, e.to_hold FROM conversation_events e WHERE e.conversation_id = ANY($1) ORDER BY e.conversation_id",
        [[a, b]],
      ),
    ).toEqual(
      [a, b].map(() => ({ transition: 'T08', actor: 'system', from_hold: true, to_hold: false })),
    );
    expect(
      (
        await rows<{ n: number }>(
          "SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id = ANY($1) AND event_type = 'conversation.handoff_requested'",
          [[a, b]],
        )
      )[0]!.n,
    ).toBe(2);
    expect(await stateOf(keep)).toEqual({ state: 'BOT_ACTIVE', hold: true, priority: 'high' });
    expect(await stateOf(other)).toEqual({ state: 'BOT_ACTIVE', hold: true, priority: 'high' });
    // Released already: the store says so, the state machine writes nothing more.
    expect(await store.release(orgs[0]!, open, a)).toBe(false);
  });
});
