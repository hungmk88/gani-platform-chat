import { createDbPool, insertOutboxEvent, withTenant } from '@gani/db';
import { uuidv7 } from '@gani/domain';

import { requireEnv } from './harness.js';

// The database side of the kill-tests. Events are written as the application writes them: as `app_role`, in a transaction of the
// organisation (`withTenant`), through `insertOutboxEvent`. What the tests look at is read as `migration_role`, which RLS does not
// hide rows from, so a row of the outbox cannot be missed because of the tenant it was read under.
export type Pool = ReturnType<typeof createDbPool>;

export const adminPool = (): Pool => createDbPool(requireEnv('DATABASE_URL_MIGRATION'), { max: 3 });
export const appPool = (): Pool => createDbPool(requireEnv('DATABASE_URL_APP'), { max: 3 });

/** A new organisation: the tests do not share one, so one test cannot see the events of another. */
export async function seedOrg(admin: Pool): Promise<string> {
  const org = uuidv7();
  await admin.query('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [
    org,
    `t-${org}`,
    'Queue test',
  ]);
  return org;
}

/** Removes what a test wrote. A step that fails does not throw: the CI database is thrown away after the job. */
export async function removeOrg(admin: Pool, org: string): Promise<void> {
  await admin.query('DELETE FROM outbox_events WHERE org_id = $1', [org]).catch(() => undefined);
  await admin.query('DELETE FROM organizations WHERE id = $1', [org]).catch(() => undefined);
}

/** The queue the relay sends the events of an organisation without a workspace to (outbox spec §5). */
export const queueOf = (org: string): string => `q.events.org.${org}`;

/** Writes `count` events of the organisation in one transaction and returns their ids, once it is committed. */
export async function writeEvents(app: Pool, org: string, count: number): Promise<string[]> {
  const ids = Array.from({ length: count }, () => uuidv7());
  await withTenant(app, { orgId: org, workspaceIds: [] }, async (tx) => {
    for (const id of ids) {
      await insertOutboxEvent(tx, {
        id,
        workspaceId: null,
        eventType: 'conversation.created',
        aggregateType: 'conversation',
        aggregateId: uuidv7(),
        aggregateVersion: 1,
        payload: {},
        actorKind: 'system',
        actorId: null,
        traceId: 'queue-test',
      });
    }
  });
  return ids;
}

export interface StatusCounts {
  readonly pending: number;
  readonly claimed: number;
  readonly published: number;
  readonly dead_letter: number;
}

export async function statusCounts(admin: Pool, org: string): Promise<StatusCounts> {
  const { rows } = await admin.query<{ status: keyof StatusCounts; n: string }>(
    'SELECT status, count(*) AS n FROM outbox_events WHERE org_id = $1 GROUP BY status',
    [org],
  );
  const counts = { pending: 0, claimed: 0, published: 0, dead_letter: 0 };
  for (const row of rows) counts[row.status] = Number(row.n);
  return counts;
}

/** The fewest and the most attempts among the events in `status`: how many times the relay has tried them. */
export async function attemptsOf(
  admin: Pool,
  org: string,
  status: keyof StatusCounts,
): Promise<{ min: number; max: number }> {
  const { rows } = await admin.query<{ min: number | null; max: number | null }>(
    'SELECT min(attempts) AS min, max(attempts) AS max FROM outbox_events WHERE org_id = $1 AND status = $2',
    [org, status],
  );
  return { min: rows[0]?.min ?? 0, max: rows[0]?.max ?? 0 };
}

/** How many of these events are `published`: the ones written while Valkey was down must not be. */
export async function publishedAmong(
  admin: Pool,
  org: string,
  ids: readonly string[],
): Promise<number> {
  const { rows } = await admin.query<{ n: string }>(
    "SELECT count(*) AS n FROM outbox_events WHERE org_id = $1 AND id = ANY($2::uuid[]) AND status = 'published'",
    [org, ids],
  );
  return Number(rows[0]?.n ?? 0);
}

/** The outbox of one organisation in a line: what a failed test reports about the database. */
export async function describeOrg(admin: Pool, org: string): Promise<string> {
  const counts = await statusCounts(admin, org);
  const pending = await attemptsOf(admin, org, 'pending');
  const claimed = await attemptsOf(admin, org, 'claimed');
  const range = (r: { min: number; max: number }): string => `${r.min}..${r.max}`;
  return `org ${org}: pending=${counts.pending} claimed=${counts.claimed} published=${counts.published} dead_letter=${counts.dead_letter}; attempts pending ${range(pending)}, claimed ${range(claimed)}`;
}

/** Every event of the organisation, whatever its status: the set that was written, read from the table once nothing writes any more. */
export async function idsOf(admin: Pool, org: string): Promise<string[]> {
  const { rows } = await admin.query<{ id: string }>(
    'SELECT id FROM outbox_events WHERE org_id = $1',
    [org],
  );
  return rows.map((row) => row.id);
}
