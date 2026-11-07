import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The SLA columns of conversations (E1, N208): what a row may hold. A running SLA has a due time; a paused one has its reason, what
// was left of it and still its due time; nothing else. The UPDATE grant of app_role is in grants.spec, the SELECT of support_role in
// the DBM-01 case there.
const org = uuidv7();
let user = '';
let conversation = '';
let admin: pg.Client;

const set = (fields: Record<string, unknown>) => {
  const keys = Object.keys(fields);
  return admin.query(
    `UPDATE conversations SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
    [conversation, ...Object.values(fields)],
  );
};
const none = { sla_due_at: null, sla_paused_reason: null, sla_remaining_seconds: null };

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  user = await seedTenant(admin, org);
  conversation = (
    (await admin.query('SELECT id FROM conversations WHERE org_id = $1', [org])).rows[0] as {
      id: string;
    }
  ).id;
});

afterAll(async () => {
  await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('the SLA of a conversation', () => {
  it('takes none, a running one, or a paused one with what was left (0 when it was overdue)', async () => {
    expect(await sqlState(set(none))).toBeUndefined();
    expect(await sqlState(set({ ...none, sla_due_at: new Date() }))).toBeUndefined();
    for (const reason of ['waiting_customer', 'outside_hours'])
      expect(
        await sqlState(
          set({ sla_due_at: new Date(), sla_paused_reason: reason, sla_remaining_seconds: 1800 }),
        ),
      ).toBeUndefined();
    expect(
      await sqlState(
        set({
          sla_due_at: new Date(),
          sla_paused_reason: 'waiting_customer',
          sla_remaining_seconds: 0,
        }),
      ),
    ).toBeUndefined();
  });

  it('refuses another reason of a pause, and a negative rest', async () => {
    expect(
      await sqlState(
        set({ sla_due_at: new Date(), sla_paused_reason: 'closed', sla_remaining_seconds: 60 }),
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        set({
          sla_due_at: new Date(),
          sla_paused_reason: 'outside_hours',
          sla_remaining_seconds: -1,
        }),
      ),
    ).toBe('23514');
  });

  it('keeps the reason and the rest together, both ways', async () => {
    expect(
      await sqlState(
        set({
          sla_due_at: new Date(),
          sla_paused_reason: 'outside_hours',
          sla_remaining_seconds: null,
        }),
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        set({ sla_due_at: new Date(), sla_paused_reason: null, sla_remaining_seconds: 60 }),
      ),
    ).toBe('23514');
  });

  it('refuses a pause with no due time to show', async () => {
    expect(
      await sqlState(
        set({ sla_due_at: null, sla_paused_reason: 'waiting_customer', sla_remaining_seconds: 60 }),
      ),
    ).toBe('23514');
  });

  it('may be written by app_role on exactly its three columns, never by support_role', async () => {
    const { rows } = await admin.query<{ role: string; column: string }>(
      `SELECT r.role, a.attname::text AS column FROM pg_attribute a
       CROSS JOIN (VALUES ('app_role'), ('support_role')) AS r(role)
       WHERE a.attrelid = 'public.conversations'::regclass AND a.attname LIKE 'sla_%'
         AND has_column_privilege(r.role, a.attrelid, a.attnum, 'UPDATE')
       ORDER BY 1, 2`,
    );
    expect(rows).toEqual(
      ['sla_due_at', 'sla_paused_reason', 'sla_remaining_seconds'].map((column) => ({
        role: 'app_role',
        column,
      })),
    );
  });
});
