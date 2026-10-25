import { uuidv7 } from '@gani/domain';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { auditOwnAccountEvent, createDbPool, withAuthUser } from '../src/index.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// app.audit_own_account_event (N162) writes audit_logs of several organisations as its owner, so these tests are the wall: only the
// person the auth transaction names, only where they are an active member, only the two actions, never another person.
const [A, B, C, D] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const seedUsers = new Map<string, string>();
const people: string[] = [];
let admin: pg.Client;
let auth: pg.Pool;
let app: pg.Client;

async function person(memberships: [org: string, status: string][], deleted = false) {
  const id = uuidv7();
  people.push(id);
  await admin.query(
    `INSERT INTO users (id, email, status, deleted_at) VALUES ($1, $2, 'active', $3)`,
    [id, `${id}@example.test`, deleted ? new Date() : null],
  );
  for (const [org, status] of memberships)
    await admin.query(
      `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'sales', $4)`,
      [uuidv7(), org, id, status],
    );
  return id;
}
const audit = (
  user: string,
  orgIds: string[],
  action: 'user.password_changed' | 'user.password_reset' = 'user.password_changed',
) => withAuthUser(auth, user, (tx) => auditOwnAccountEvent(tx, { action, orgIds, newId: uuidv7 }));
const rowsOf = async (user: string) =>
  (
    await admin.query<{
      org_id: string;
      actor_user_id: string;
      action: string;
      target_type: string;
      target_id: string;
      detail: object;
    }>(
      `SELECT org_id, actor_user_id, action, target_type, target_id, detail FROM audit_logs WHERE actor_user_id = $1 ORDER BY org_id`,
      [user],
    )
  ).rows;
const raw = (user: string | null, action: string, orgIds: string, ids: string) =>
  sqlState(
    user
      ? withAuthUser(auth, user, (tx) =>
          tx.execute(
            sql`SELECT app.audit_own_account_event(${action}, ${orgIds}::uuid[], ${ids}::uuid[])`,
          ),
        )
      : auth.query('SELECT app.audit_own_account_event($1, $2::uuid[], $3::uuid[])', [
          action,
          orgIds,
          ids,
        ]),
  );

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  auth = createDbPool(url('auth'), { max: 2 });
  app = new pg.Client({ connectionString: url('app') });
  await app.connect();
  for (const org of [A, B, C, D]) seedUsers.set(org, await seedTenant(admin, org));
});

afterAll(async () => {
  await app.end();
  await auth.end();
  await admin.query('DELETE FROM org_members WHERE user_id = ANY($1::uuid[])', [people]);
  for (const [org, user] of seedUsers) await cleanupTenant(admin, org, user);
  await admin
    .query('DELETE FROM users WHERE id = ANY($1::uuid[])', [people])
    .catch(() => undefined);
  await admin.end();
});

describe('app.audit_own_account_event', () => {
  it('writes one row in each organisation where the person is active, and skips the others', async () => {
    const p = await person([
      [A, 'active'],
      [B, 'active'],
      [C, 'suspended'],
    ]);
    expect(await audit(p, [A, B, C, D])).toBe(2);
    const rows = await rowsOf(p);
    expect(rows.map((r) => r.org_id)).toEqual([A, B].sort());
    for (const row of rows)
      expect(row).toMatchObject({
        actor_user_id: p,
        action: 'user.password_changed',
        target_type: 'user',
        target_id: p,
        detail: {},
      });
    expect(await audit(p, [], 'user.password_reset')).toBe(0);
  });

  it('writes nothing for a deleted person, or for an organisation of someone else', async () => {
    const [gone, other] = [await person([[A, 'active']], true), await person([[B, 'active']])];
    expect(await audit(gone, [A])).toBe(0);
    expect(await audit(other, [A])).toBe(0);
    expect([...(await rowsOf(gone)), ...(await rowsOf(other))]).toEqual([]);
  });

  it('refuses no signed-in person, another action, ids that do not pair, an organisation twice, and app_role', async () => {
    const p = await person([[A, 'active']]);
    const [one, two] = [`{${uuidv7()}}`, `{${uuidv7()},${uuidv7()}}`];
    expect(await raw(null, 'user.password_changed', `{${A}}`, one)).toBe('42501');
    expect(await raw(p, 'member.role_changed', `{${A}}`, one)).toBe('22023');
    expect(await raw(p, 'user.password_changed', `{${A}}`, two)).toBe('22023');
    expect(await raw(p, 'user.password_changed', `{${A},${A}}`, two)).toBe('22023');
    expect(
      await sqlState(
        app.query('SELECT app.audit_own_account_event($1, $2::uuid[], $3::uuid[])', [
          'user.password_changed',
          `{${A}}`,
          one,
        ]),
      ),
    ).toBe('42501');
    expect(await rowsOf(p)).toEqual([]);
  });
});
