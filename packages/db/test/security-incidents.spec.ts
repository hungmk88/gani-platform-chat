import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sqlState, url, withClient } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// P11a (N207): what the tables of security alerts and incidents refuse, and the check of an operator's access session
// (app.access_session_org, B2), one condition per test so a mutant of each is caught alone. RLS and the absence of DELETE are
// covered for every table by rls-all-tables.spec; the UPDATE columns by grants.spec.
const [org, other] = [uuidv7(), uuidv7()];
const users: string[] = [];
const operator = uuidv7();
let admin: pg.Client;

const q = (text: string, params: unknown[] = []) => admin.query(text, params);
const incident = (fields: Record<string, unknown>) => {
  const row = {
    id: uuidv7(),
    org_id: org,
    title: 'T',
    severity: 'high',
    handler_user_id: users[0],
    opened_by_user_id: users[0],
    ...fields,
  };
  const keys = Object.keys(row);
  return q(
    `INSERT INTO security_incidents (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
    Object.values(row),
  );
};
const alert = (fields: Record<string, unknown>) => {
  const row = {
    id: uuidv7(),
    org_id: org,
    kind: 'login_failures',
    severity: 'medium',
    window_start: '2026-11-07T10:00:00Z',
    ...fields,
  };
  const keys = Object.keys(row);
  return q(
    `INSERT INTO security_alerts (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
    Object.values(row),
  );
};
/** A session of `who` on `org`, started `ago` minutes ago and lasting `minutes`. */
async function session(who: string, ago = 5, minutes = 60, ended = false) {
  const id = uuidv7();
  await q(
    `INSERT INTO platform_access_logs (id, org_id, operator_user_id, db_login, reason, created_at, expires_at, ended_at, end_reason)
     VALUES ($1, $2, $3, 'api', 'Kiểm tra sự cố', now() - make_interval(mins => $4), now() - make_interval(mins => $4) + make_interval(mins => $5),
       CASE WHEN $6 THEN now() END, CASE WHEN $6 THEN 'manual' END)`,
    [id, org, who, ago, minutes, ended],
  );
  return id;
}
const orgOf = (role: 'auth' | 'app' | 'support', id: string, who: string) =>
  withClient(
    role,
    async (c) =>
      (
        await c.query<{ org: string | null }>('SELECT app.access_session_org($1, $2) AS org', [
          id,
          who,
        ])
      ).rows[0]?.org,
  );

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  for (const o of [org, other]) users.push(await seedTenant(admin, o));
  await q(
    `INSERT INTO users (id, email, status, is_platform_operator) VALUES ($1, $2, 'active', true)`,
    [operator, `${operator}@example.test`],
  );
});

afterAll(async () => {
  await q('DELETE FROM platform_access_logs WHERE operator_user_id = $1', [operator]);
  await q('DELETE FROM security_alerts WHERE org_id = ANY($1::uuid[])', [[org, other]]);
  await q('DELETE FROM security_incidents WHERE org_id = ANY($1::uuid[])', [[org, other]]);
  await q('DELETE FROM users WHERE id = $1', [operator]);
  for (const [i, o] of [org, other].entries()) await cleanupTenant(admin, o, users[i] as string);
  await admin.end();
});

describe('security_incidents', () => {
  it('takes an incident opened by a member or by an operator, never both or neither', async () => {
    expect(await sqlState(incident({}))).toBeUndefined();
    expect(
      await sqlState(incident({ opened_by_user_id: null, opened_by_operator_id: operator })),
    ).toBeUndefined();
    expect(await sqlState(incident({ opened_by_operator_id: operator }))).toBe('23514');
    expect(await sqlState(incident({ opened_by_user_id: null }))).toBe('23514');
  });

  it('keeps status and closed_at together both ways, and only the known severities and a real title', async () => {
    expect(await sqlState(incident({ status: 'closed', closed_at: new Date() }))).toBeUndefined();
    expect(await sqlState(incident({ status: 'closed' }))).toBe('23514');
    expect(await sqlState(incident({ closed_at: new Date() }))).toBe('23514');
    expect(await sqlState(incident({ status: 'resolved' }))).toBe('23514');
    expect(await sqlState(incident({ severity: 'urgent' }))).toBe('23514');
    expect(await sqlState(incident({ title: '  ' }))).toBe('23514');
  });

  it('refuses a handler or an opener who is not a member of the organisation', async () => {
    expect(await sqlState(incident({ handler_user_id: users[1] }))).toBe('23503');
    expect(await sqlState(incident({ opened_by_user_id: users[1] }))).toBe('23503');
    expect(
      await sqlState(incident({ opened_by_user_id: null, opened_by_operator_id: uuidv7() })),
    ).toBe('23503');
  });
});

describe('security_alerts', () => {
  it('keeps one alert per kind, subject and window, and only the known kinds, severities and counts', async () => {
    const window = { subject_user_id: users[0], window_start: '2026-11-07T11:00:00Z' };
    expect(await sqlState(alert(window))).toBeUndefined();
    expect(await sqlState(alert(window))).toBe('23505');
    expect(await sqlState(alert({ window_start: '2026-11-07T12:00:00Z' }))).toBeUndefined();
    expect(await sqlState(alert({ window_start: '2026-11-07T12:00:00Z' }))).toBe('23505');
    expect(await sqlState(alert({ kind: 'phishing' }))).toBe('23514');
    expect(
      await sqlState(alert({ severity: 'urgent', window_start: '2026-11-07T13:00:00Z' })),
    ).toBe('23514');
    expect(await sqlState(alert({ count: 0, window_start: '2026-11-07T14:00:00Z' }))).toBe('23514');
  });

  it('never points at an incident or a channel account of another organisation', async () => {
    const theirs = uuidv7();
    await incident({
      id: theirs,
      org_id: other,
      handler_user_id: users[1],
      opened_by_user_id: users[1],
    });
    expect(
      await sqlState(alert({ incident_id: theirs, window_start: '2026-11-07T15:00:00Z' })),
    ).toBe('23503');
    const channel = (
      (await q('SELECT id FROM channel_accounts WHERE org_id = $1', [other])).rows[0] as {
        id: string;
      }
    ).id;
    expect(
      await sqlState(alert({ channel_account_id: channel, window_start: '2026-11-07T16:00:00Z' })),
    ).toBe('23503');
  });
});

describe('the end of an access session (B3)', () => {
  it('keeps ended_at and end_reason together, with a known reason', async () => {
    const id = await session(operator);
    expect(
      await sqlState(q(`UPDATE platform_access_logs SET ended_at = now() WHERE id = $1`, [id])),
    ).toBe('23514');
    expect(
      await sqlState(
        q(`UPDATE platform_access_logs SET end_reason = 'manual' WHERE id = $1`, [id]),
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        q(
          `UPDATE platform_access_logs SET ended_at = now(), end_reason = 'revoked' WHERE id = $1`,
          [id],
        ),
      ),
    ).toBe('23514');
  });
});

describe('app.access_session_org (B2)', () => {
  it('gives the organisation of a running session of the operator who calls', async () => {
    expect(await orgOf('auth', await session(operator), operator)).toBe(org);
  });

  it('gives nothing for a session of another person', async () => {
    const id = await session(operator);
    expect(await orgOf('auth', id, users[0] as string)).toBeNull();
  });

  it('gives nothing once the session has run out', async () => {
    expect(await orgOf('auth', await session(operator, 50, 45), operator)).toBeNull();
  });

  it('gives nothing once the session was ended', async () => {
    expect(await orgOf('auth', await session(operator, 5, 60, true), operator)).toBeNull();
  });

  it('gives nothing to a person who is no longer a platform operator', async () => {
    const id = await session(operator);
    await q('UPDATE users SET is_platform_operator = false WHERE id = $1', [operator]);
    try {
      expect(await orgOf('auth', id, operator)).toBeNull();
    } finally {
      await q('UPDATE users SET is_platform_operator = true WHERE id = $1', [operator]);
    }
  });

  it('may be called by auth_role only', async () => {
    const id = await session(operator);
    expect(await sqlState(orgOf('app', id, operator))).toBe('42501');
    expect(await sqlState(orgOf('support', id, operator))).toBe('42501');
  });
});
