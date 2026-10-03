import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sqlState, url } from './db.js';

// Table constraints of users (migration 202610031200). Written by migration_role: app_role cannot touch the table.
const ids: string[] = [];
let admin: pg.Client;

const insert = (over: { email?: string; status?: string; since?: Date | null }) => {
  const id = uuidv7();
  ids.push(id);
  return admin.query(
    'INSERT INTO users (id, email, status, pending_password_since) VALUES ($1, $2, $3, $4)',
    [id, over.email ?? `${id}@example.test`, over.status ?? 'active', over.since ?? null],
  );
};

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
});

afterAll(async () => {
  await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
  await admin.end();
});

describe('users: constraints', () => {
  it.each([
    ['upper-case email', { email: 'Mixed@Example.test' }],
    ['email with surrounding spaces', { email: ' a@example.test ' }],
    ['empty email', { email: '' }],
    ['unknown status', { status: 'banned' }],
    ['pending_password without pending_password_since', { status: 'pending_password' }],
    ['active with pending_password_since', { status: 'active', since: new Date() }],
  ])('rejects %s', async (_name, over) => {
    expect(await sqlState(insert(over))).toBe('23514');
  });

  it('accepts a pending_password user with its timestamp', async () => {
    await insert({ status: 'pending_password', since: new Date() });
  });

  it('rejects a second user with the same email', async () => {
    const email = `dup-${uuidv7()}@example.test`;
    await insert({ email });
    expect(await sqlState(insert({ email }))).toBe('23505');
  });
});
