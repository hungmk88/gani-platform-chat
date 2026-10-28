import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { messagePreview, uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { backfillLastMessagePreview } from '../scripts/backfill-last-message-preview.mjs';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The backfill of the preview of the Inbox (U30, N169) as migration_role, on the real partitioned messages: rows written as they were
// before 202610291000 (last_message_at set by hand, no preview), the old message of a conversation in another partition than its last
// one. Every run is kept to one organisation (--org), so rows other files leave in the shared database never change the counts.
const admin = new pg.Client({ connectionString: url('migration') });
const [A, B] = [uuidv7(), uuidv7()];
const users = new Map<string, string>();
const LONG = `Dạ em xin chào anh,\n\n  bên em có ${'sản phẩm mới '.repeat(12)}`.normalize('NFD');
type Row = { id: string; kind: string | null; text: string | null };

const conversation = async (
  org: string,
  lastMessageAt: boolean,
  kind: string | null = null,
  text: string | null = null,
) => {
  const id = uuidv7();
  await admin.query(
    `INSERT INTO conversations (id, org_id, workspace_id, state, last_message_at, last_message_kind, last_message_preview)
     SELECT $1, $2, id, 'BOT_ACTIVE', CASE WHEN $3 THEN now() END, $4, $5 FROM workspaces WHERE org_id = $2`,
    [id, org, lastMessageAt, kind, text],
  );
  return id;
};
const message = (
  org: string,
  c: string,
  seq: number,
  sender: string,
  kind: string,
  body: string | null,
  old = false,
) =>
  admin.query(
    `INSERT INTO messages (id, org_id, workspace_id, conversation_id, sequence_number, sender_kind, kind, body, created_at)
     SELECT $1, $2, workspace_id, $3, $4, $5, $6, $7, CASE WHEN $8 THEN now() - interval '400 days' ELSE now() END
     FROM conversations WHERE id = $3`,
    [uuidv7(), org, c, seq, sender, kind, body, old],
  );
const rows = async (org: string): Promise<Row[]> =>
  (
    await admin.query<Row>(
      `SELECT id, last_message_kind AS kind, last_message_preview AS text FROM conversations
       WHERE org_id = $1 AND last_message_at IS NOT NULL ORDER BY id`,
      [org],
    )
  ).rows;
const run = (orgId: string, extra: { dryRun?: boolean; batchSize?: number } = {}) => {
  const lines: string[] = [];
  return backfillLastMessagePreview({
    connectionString: url('migration'),
    orgId,
    batchSize: 2,
    log: (l) => lines.push(l),
    ...extra,
  }).then((result) => ({ ...result, lines }));
};

type Case = 'text' | 'image' | 'system' | 'onlySystem' | 'filled' | 'none' | 'other' | 'race';
const c = {} as Record<Case, string>;
beforeAll(async () => {
  await admin.connect();
  for (const org of [A, B]) users.set(org, await seedTenant(admin, org));
  c.text = await conversation(A, true);
  await message(A, c.text, 1, 'customer', 'image', null, true);
  await message(A, c.text, 2, 'agent', 'text', LONG);
  c.image = await conversation(A, true);
  await message(A, c.image, 1, 'customer', 'text', 'trước', true);
  await message(A, c.image, 2, 'customer', 'image', null);
  c.system = await conversation(A, true);
  await message(A, c.system, 1, 'customer', 'text', 'giá bao nhiêu');
  await message(A, c.system, 2, 'system', 'system', 'hệ thống');
  c.onlySystem = await conversation(A, true);
  await message(A, c.onlySystem, 1, 'system', 'system', 'hệ thống');
  c.filled = await conversation(A, true, 'text', 'tin mới');
  await message(A, c.filled, 1, 'customer', 'text', 'tin cũ');
  c.none = await conversation(A, false);
  c.other = await conversation(B, true);
  await message(B, c.other, 1, 'customer', 'sticker', null);
});

// cleanupTenant removes the messages and conversations of both organisations too.
afterAll(async () => {
  for (const org of [A, B]) await cleanupTenant(admin, org, users.get(org) ?? '');
  await admin.end();
});

describe('backfill of last_message_kind / last_message_preview', () => {
  it('reads messages from more than one partition', async () => {
    const { rows: parts } = await admin.query<{ n: number }>(
      'SELECT count(DISTINCT tableoid)::int AS n FROM messages WHERE org_id = $1',
      [A],
    );
    expect(parts[0]?.n).toBeGreaterThan(1);
  });

  it('dry run counts what it would take and writes nothing', async () => {
    const before = await rows(A);
    const result = await run(A, { dryRun: true });
    expect(result).toMatchObject({ total: 4, processed: 0, updated: 0, dryRun: true });
    expect(result.lines).toEqual([
      'backfill-last-message-preview: dry run, 4 conversation(s) to fill, nothing written',
    ]);
    expect(await rows(A)).toEqual(before);
  });

  it('fills one organisation in batches, then a second run changes nothing', async () => {
    const first = await run(A);
    expect(first).toMatchObject({ total: 4, processed: 4, updated: 3 });
    expect(first.lines.slice(0, 2).map((l) => l.replace(/ETA \d+s/, 'ETA'))).toEqual([
      'backfill-last-message-preview: processed 2/4, ETA',
      'backfill-last-message-preview: processed 4/4, ETA',
    ]);
    expect(first.lines.join('\n')).not.toMatch(/xin chào|giá bao nhiêu|trước|tin cũ/);
    const after = await rows(A);
    const by = new Map(after.map((r) => [r.id, r]));
    expect(by.get(c.text)).toEqual({
      id: c.text,
      kind: 'text',
      text: messagePreview('text', LONG),
    });
    expect(by.get(c.text)?.text).toHaveLength(120);
    expect(by.get(c.image)).toEqual({ id: c.image, kind: 'image', text: null });
    expect(by.get(c.system)).toEqual({ id: c.system, kind: 'text', text: 'giá bao nhiêu' });
    expect(by.get(c.onlySystem)).toEqual({ id: c.onlySystem, kind: null, text: null });
    expect(by.get(c.filled)).toEqual({ id: c.filled, kind: 'text', text: 'tin mới' });
    expect(await rows(B)).toEqual([{ id: c.other, kind: null, text: null }]);

    const second = await run(A);
    expect(second).toMatchObject({ total: 1, processed: 1, updated: 0 });
    expect(await rows(A)).toEqual(after);
  });

  it('fills the other organisation when asked', async () => {
    expect(await run(B, { batchSize: 1000 })).toMatchObject({ total: 1, updated: 1 });
    expect(await rows(B)).toEqual([{ id: c.other, kind: 'sticker', text: null }]);
  });

  it('never overwrites a preview that insertMessage writes between its read and its write', async () => {
    c.race = await conversation(B, true);
    await message(B, c.race, 1, 'customer', 'text', 'tin cũ hơn');
    const other = new pg.Client({ connectionString: url('migration') });
    await other.connect();
    try {
      await other.query('BEGIN');
      await other.query(
        "UPDATE conversations SET last_message_kind = 'text', last_message_preview = 'tin mới hơn' WHERE id = $1",
        [c.race],
      );
      const running = run(B);
      // The backfill read the row before that commit and now waits on its lock.
      await expect
        .poll(
          async () =>
            (
              await admin.query<{ n: number }>(
                "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'UPDATE conversations c SET%'",
              )
            ).rows[0]?.n,
          { timeout: 10_000 },
        )
        .toBe(1);
      await other.query('COMMIT');
      expect(await running).toMatchObject({ total: 1, updated: 0 });
    } finally {
      await other.end();
    }
    const race = (await rows(B)).find((r) => r.id === c.race);
    expect(race).toEqual({ id: c.race, kind: 'text', text: 'tin mới hơn' });
  });
});

describe('the script', () => {
  const script = fileURLToPath(
    new URL('../scripts/backfill-last-message-preview.mjs', import.meta.url),
  );
  const cli = (args: string[], env: Record<string, string>) =>
    spawnSync(process.execPath, [script, ...args], {
      env: { PATH: process.env['PATH'] ?? '', ...env },
      encoding: 'utf8',
    });

  it('refuses without APP_ENV, and an unknown argument, before it connects', () => {
    const noEnv = cli(['--dry-run'], { DATABASE_URL_MIGRATION: url('migration') });
    expect([noEnv.status, noEnv.stderr.trim()]).toEqual([
      2,
      'backfill-last-message-preview: APP_ENV is not set: say which environment this runs on',
    ]);
    const bad = cli(['--org', 'nope'], {
      APP_ENV: 'test',
      DATABASE_URL_MIGRATION: url('migration'),
    });
    expect(bad.status).toBe(2);
  });

  it('dry-runs from the command line', () => {
    const run = cli(['--dry-run', '--org', B], {
      APP_ENV: 'test',
      DATABASE_URL_MIGRATION: url('migration'),
    });
    expect([run.status, run.stderr]).toEqual([0, '']);
    expect(run.stdout.trim().split('\n')).toEqual([
      'backfill-last-message-preview: APP_ENV=test, one organisation',
      'backfill-last-message-preview: dry run, 0 conversation(s) to fill, nothing written',
    ]);
  });
});
