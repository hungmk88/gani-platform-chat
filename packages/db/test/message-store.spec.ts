import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  PLATFORM_CLOCK_SKEW_WARN_SECONDS,
  createDbPool,
  insertMessage,
  withTenant,
  type NewMessage,
} from '../src/index.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// insertMessage (realtime-spec §4, N4): the number of a message, the lock that makes the numbers follow the commits, the late message,
// the two marks of the conversation, and the tenant. Org A has workspaces WA and WA2; B is a stranger. Each test makes its own
// conversation, and afterAll removes only those (the conversation of seedTenant has a message and is left to cleanupTenant).
const [A, B, WA2] = [uuidv7(), uuidv7(), uuidv7()];
const orgs = [A, B];
const users = new Map<string, string>();
const made: string[] = [];
let [WA, WB] = ['', ''];
let admin: pg.Client;
let pool: pg.Pool;

const inA = <T>(workspaces: string[], fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(pool, { orgId: A, workspaceIds: workspaces }, fn);
const conversation = async (org = A, workspace = WA) => {
  const id = uuidv7();
  await admin.query(
    "INSERT INTO conversations (id, org_id, workspace_id, state) VALUES ($1, $2, $3, 'BOT_ACTIVE')",
    [id, org, workspace],
  );
  made.push(id);
  return id;
};
const message = (conversationId: string, over: Partial<NewMessage> = {}): NewMessage => ({
  id: uuidv7(),
  conversationId,
  workspaceId: WA,
  senderKind: 'customer',
  kind: 'text',
  body: 'hello',
  ...over,
});
const add = (m: NewMessage) => inA([WA], (tx) => insertMessage(tx, m));
const numbers = async (conversationId: string) =>
  (
    await admin.query<{ n: number }>(
      'SELECT sequence_number::int AS n FROM messages WHERE conversation_id = $1 ORDER BY sequence_number',
      [conversationId],
    )
  ).rows.map((r) => r.n);
const marks = async (conversationId: string) =>
  (
    await admin.query<{ last: Date | null; customer: Date | null }>(
      'SELECT last_message_at AS last, last_customer_message_at AS customer FROM conversations WHERE id = $1',
      [conversationId],
    )
  ).rows[0];
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 20 });
  for (const org of orgs) users.set(org, await seedTenant(admin, org));
  const ws = async (org: string) =>
    (
      (await admin.query<{ id: string }>('SELECT id FROM workspaces WHERE org_id = $1', [org]))
        .rows[0] as { id: string }
    ).id;
  [WA, WB] = [await ws(A), await ws(B)];
  await admin.query(
    "INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ws2', 'W2', 'service')",
    [WA2, A],
  );
});

afterAll(async () => {
  await pool.end();
  await admin.query('DELETE FROM messages WHERE conversation_id = ANY($1::uuid[])', [made]);
  await admin.query('DELETE FROM conversations WHERE id = ANY($1::uuid[])', [made]);
  await admin.query('DELETE FROM workspaces WHERE id = $1', [WA2]);
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('sequence_number', () => {
  it('starts at 1 and goes up by one, with the row written as given', async () => {
    const c = await conversation();
    const sentAt = new Date('2026-01-01T10:00:00.123Z');
    const first = await add(
      message(c, { platformMessageId: 'p-1', platformSentAt: sentAt, body: 'one' }),
    );
    const second = await add(message(c, { senderKind: 'bot', kind: 'text', body: 'two' }));
    expect([first.sequenceNumber, second.sequenceNumber]).toEqual([1, 2]);
    const { rows } = await admin.query('SELECT * FROM messages WHERE id = $1', [first.id]);
    expect(rows).toMatchObject([
      {
        org_id: A,
        workspace_id: WA,
        conversation_id: c,
        sender_kind: 'customer',
        kind: 'text',
        body: 'one',
        platform_message_id: 'p-1',
      },
    ]);
    // A Date has milliseconds: the time of the platform comes back as it went in.
    expect((rows[0] as { platform_sent_at: Date }).platform_sent_at.toISOString()).toBe(
      sentAt.toISOString(),
    );
  });

  it('gives 50 messages written at once exactly 1..50, no repeat and no gap', async () => {
    const c = await conversation();
    const got = await Promise.all(range(50).map(() => add(message(c))));
    expect(got.map((g) => g.sequenceNumber).sort((x, y) => x - y)).toEqual(range(50));
    expect(await numbers(c)).toEqual(range(50));
  });

  it('leaves no gap when a transaction fails after it took a number', async () => {
    const c = await conversation();
    await add(message(c));
    const failing = inA([WA], async (tx) => {
      await insertMessage(tx, message(c));
      throw new Error('stop');
    });
    await expect(failing).rejects.toThrow('stop');
    expect((await add(message(c))).sequenceNumber).toBe(2);
    expect(await numbers(c)).toEqual([1, 2]);
  });

  it('never shows a reader a gap while 30 writers commit (the number follows the commit)', async () => {
    const c = await conversation();
    let done = false;
    let gaps = 0;
    const reader = (async () => {
      while (!done) {
        const { rows } = await admin.query<{ count: number; max: number }>(
          'SELECT count(*)::int AS count, coalesce(max(sequence_number), 0)::int AS max FROM messages WHERE conversation_id = $1',
          [c],
        );
        if (rows[0]?.count !== rows[0]?.max) gaps++;
      }
    })();
    try {
      await Promise.all(range(30).map(() => add(message(c))));
    } finally {
      done = true;
    }
    await reader;
    expect(gaps).toBe(0);
    expect(await numbers(c)).toEqual(range(30));
  });

  it('makes writers of one conversation wait, and lets another conversation through', async () => {
    const [c1, c2] = [await conversation(), await conversation()];
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const taken = new Promise<void>((resolve) => (held = resolve));
    const first = inA([WA], async (tx) => {
      await insertMessage(tx, message(c1));
      held();
      await hold;
    });
    await taken;
    const other = await Promise.race([
      add(message(c2)).then(() => 'done'),
      new Promise((resolve) => setTimeout(() => resolve('blocked'), 5000)),
    ]);
    expect(other).toBe('done');
    const same = add(message(c1));
    let waiting = false;
    for (let i = 0; i < 100 && !waiting; i++) {
      const { rowCount } = await admin.query(
        "SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted",
      );
      waiting = (rowCount ?? 0) > 0;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(waiting).toBe(true);
    release();
    await first;
    expect((await same).sequenceNumber).toBe(2);
  });

  it('gives a message that arrives late a higher number, and it shows before the others by its send time', async () => {
    const c = await conversation();
    const at = (h: number) => new Date(`2026-01-01T${String(h).padStart(2, '0')}:00:00Z`);
    await add(message(c, { platformMessageId: 'p-b', platformSentAt: at(10) }));
    const late = await add(message(c, { platformMessageId: 'p-a', platformSentAt: at(9) }));
    await add(message(c, { platformMessageId: 'p-a2', platformSentAt: at(9) }));
    expect(late.sequenceNumber).toBe(2);
    const { rows } = await admin.query<{ id: string }>(
      'SELECT platform_message_id AS id FROM messages WHERE conversation_id = $1 ORDER BY platform_sent_at, platform_message_id',
      [c],
    );
    expect(rows.map((r) => r.id)).toEqual(['p-a', 'p-a2', 'p-b']);
  });
});

describe('the marks of the conversation', () => {
  it('sets last_message_at for any sender, and last_customer_message_at for a customer only', async () => {
    const c = await conversation();
    expect(await marks(c)).toEqual({ last: null, customer: null });
    await add(message(c, { senderKind: 'agent', senderUserId: users.get(A) as string }));
    const afterAgent = await marks(c);
    expect(afterAgent?.last).toBeInstanceOf(Date);
    expect(afterAgent?.customer).toBeNull();
    await add(message(c, { platformSentAt: new Date('2026-01-01T10:00:00Z') }));
    expect((await marks(c))?.customer?.toISOString()).toBe('2026-01-01T10:00:00.000Z');
  });

  it('uses now() for the customer mark when the platform gave no time', async () => {
    const c = await conversation();
    await add(message(c));
    const customer = (await marks(c))?.customer as Date;
    expect(Math.abs(customer.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it('only moves the customer mark forward: a late message does not pull the window back', async () => {
    const c = await conversation();
    const at = (h: number) => new Date(`2026-01-01T${String(h).padStart(2, '0')}:00:00Z`);
    await add(message(c, { platformSentAt: at(10) }));
    await add(message(c, { platformSentAt: at(9) }));
    expect((await marks(c))?.customer?.toISOString()).toBe(at(10).toISOString());
    await add(message(c, { platformSentAt: at(11) }));
    expect((await marks(c))?.customer?.toISOString()).toBe(at(11).toISOString());
  });

  it('keeps a stored time that has microseconds above the same time in milliseconds', async () => {
    const c = await conversation();
    await admin.query(
      "UPDATE conversations SET last_customer_message_at = '2026-01-01T10:00:00.123456Z', last_message_at = now() + interval '1 hour' WHERE id = $1",
      [c],
    );
    const before = (await marks(c))?.last as Date;
    await add(message(c, { platformSentAt: new Date('2026-01-01T10:00:00.123Z') }));
    const { rows } = await admin.query<{ micro: string }>(
      "SELECT to_char(last_customer_message_at AT TIME ZONE 'UTC', 'HH24:MI:SS.US') AS micro FROM conversations WHERE id = $1",
      [c],
    );
    expect(rows[0]?.micro).toBe('10:00:00.123456');
    // last_message_at, set ahead on purpose, did not go back either.
    expect((await marks(c))?.last?.getTime()).toBe(before.getTime());
  });
});

describe('a platform time that is ahead of now (N116)', () => {
  const in2099 = new Date('2099-01-01T00:00:00Z');
  const read = async (id: string, conversationId: string) => {
    const { rows } = await admin.query<{
      sent: Date | null;
      sent_ok: boolean | null;
      mark_ok: boolean;
    }>(
      `SELECT m.platform_sent_at AS sent, m.platform_sent_at <= now() AS sent_ok,
              c.last_customer_message_at <= now() AS mark_ok
       FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.id = $1 AND c.id = $2`,
      [id, conversationId],
    );
    return rows[0] as { sent: Date | null; sent_ok: boolean | null; mark_ok: boolean };
  };

  it('clamps a time in 2099 to now: the message, the mark, and the number of seconds it was ahead', async () => {
    const c = await conversation();
    const stored = await add(message(c, { platformSentAt: in2099 }));
    expect(await read(stored.id, c)).toMatchObject({ sent_ok: true, mark_ok: true });
    expect(stored.platformSentAtAheadSeconds).toBeGreaterThan(3 * 365 * 86_400);
  });

  it('clamps a time a few minutes ahead too, and reports it as ahead by less than the warning limit', async () => {
    const c = await conversation();
    const stored = await add(message(c, { platformSentAt: new Date(Date.now() + 4 * 60_000) }));
    expect(await read(stored.id, c)).toMatchObject({ sent_ok: true, mark_ok: true });
    expect(stored.platformSentAtAheadSeconds).toBeGreaterThan(0);
    expect(stored.platformSentAtAheadSeconds).toBeLessThan(PLATFORM_CLOCK_SKEW_WARN_SECONDS);
  });

  it('keeps a time in the past as it was, and a missing time as NULL with the mark at now()', async () => {
    const [c1, c2] = [await conversation(), await conversation()];
    const past = new Date('2026-01-01T10:00:00.123Z');
    const kept = await add(message(c1, { platformSentAt: past }));
    expect((await read(kept.id, c1)).sent?.toISOString()).toBe(past.toISOString());
    expect(kept.platformSentAtAheadSeconds).toBeNull();
    const none = await add(message(c2));
    expect((await read(none.id, c2)).sent).toBeNull();
    expect(none.platformSentAtAheadSeconds).toBeNull();
    expect(Math.abs(((await marks(c2))?.customer as Date).getTime() - Date.now())).toBeLessThan(
      60_000,
    );
  });

  it('heals a mark that was written in the future: the next customer message brings it back to now', async () => {
    const c = await conversation();
    await admin.query('UPDATE conversations SET last_customer_message_at = $2 WHERE id = $1', [
      c,
      in2099,
    ]);
    const stored = await add(message(c, { platformSentAt: new Date('2026-01-01T09:00:00Z') }));
    expect((await read(stored.id, c)).mark_ok).toBe(true);
    const mark = (await marks(c))?.customer as Date;
    expect(mark.getUTCFullYear()).toBeLessThan(2099);
    expect(Math.abs(mark.getTime() - Date.now())).toBeLessThan(60_000);
  });
});

describe('the tenant', () => {
  it('refuses a conversation of a workspace the tenant may not use, and one of another organisation (42501)', async () => {
    const [inWa2, ofB] = [await conversation(A, WA2), await conversation(B, WB)];
    expect(await sqlState(add(message(inWa2, { workspaceId: WA2 })))).toBe('42501');
    expect(await sqlState(add(message(ofB, { workspaceId: WB })))).toBe('42501');
    expect(await numbers(inWa2)).toEqual([]);
  });

  it('refuses a workspace that is not the one of the conversation (23503)', async () => {
    const c = await conversation();
    const wrong = inA([WA, WA2], (tx) => insertMessage(tx, message(c, { workspaceId: WA2 })));
    expect(await sqlState(wrong)).toBe('23503');
    expect(await numbers(c)).toEqual([]);
  });

  it('takes the organisation from the context: the row is A even though nothing names it', async () => {
    const c = await conversation();
    const stored = await add(message(c));
    const { rows } = await admin.query('SELECT org_id FROM messages WHERE id = $1', [stored.id]);
    expect(rows).toEqual([{ org_id: A }]);
  });
});
