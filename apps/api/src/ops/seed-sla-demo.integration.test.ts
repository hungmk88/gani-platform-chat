import { createDbPool } from '@gani/db';
import { afterAll, describe, expect, it } from 'vitest';

import { verifyPassword } from '../modules/auth/password.js';
import { seedSlaDemo } from './seed-sla-demo.js';

// The six cases of the SLA demo (CEO brief 11) on PostgreSQL, as `Conversation.sla` and `?sla=` read them (E3b): what FE sees.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 1 });
const app = createDbPool(need('DATABASE_URL_APP'), { max: 1 });
afterAll(() => Promise.all([admin.end(), app.end()]));

describe('seedSlaDemo', () => {
  it('makes the six cases: within, due soon, overdue, waiting for the customer, outside the hours, closed; and a person who signs in', async () => {
    const now = new Date();
    const demo = await seedSlaDemo(admin, app, now);
    const { rows } = await admin.query<{
      id: string;
      state: string;
      due: Date | null;
      reason: string | null;
      left: number | null;
    }>(
      `SELECT id, state, sla_due_at AS due, sla_paused_reason AS reason, sla_remaining_seconds AS left FROM conversations WHERE org_id = $1`,
      [demo.orgId],
    );
    const of = (id: string) => rows.find((r) => r.id === id);
    const minutesLeft = (id: string) => ((of(id)?.due?.getTime() ?? 0) - now.getTime()) / 60_000;
    const c = demo.conversations;
    expect(of(c.within)).toMatchObject({ state: 'HUMAN_WAITING_Q', reason: null });
    expect(minutesLeft(c.within)).toBe(60);
    expect(of(c.dueSoon)?.reason).toBeNull();
    expect(minutesLeft(c.dueSoon)).toBe(10);
    expect(of(c.overdue)?.reason).toBeNull();
    expect(minutesLeft(c.overdue)).toBe(-5);
    expect(of(c.waitingCustomer)).toMatchObject({
      state: 'PENDING_CUSTOMER',
      reason: 'waiting_customer',
      left: 3600,
    });
    expect(of(c.outsideHours)).toMatchObject({
      state: 'HUMAN_WAITING_Q',
      reason: 'outside_hours',
      left: 3600,
    });
    expect(of(c.closed)).toMatchObject({ state: 'CLOSED', due: null, reason: null });
    const hash = await admin.query<{ password: string }>(
      `SELECT a.password FROM accounts a JOIN users u ON u.id = a.user_id WHERE u.email = $1`,
      [demo.email],
    );
    expect(
      await verifyPassword({ hash: hash.rows[0]?.password ?? '', password: demo.password }),
    ).toBe(true);
  });
});
