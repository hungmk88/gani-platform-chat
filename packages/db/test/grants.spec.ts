import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { url } from './db.js';

// Least privilege by column (review H DB-05, review I DBM-01): the columns app_role may UPDATE, table by table, as code. A migration
// that grants UPDATE on another column, or on a whole table, fails here until this list says so. No column of a row's identity
// (id, org_id), of what it belongs to, or of who made it and when is in it. Partitions are left out: they get no privilege (spec §6).
const APP_UPDATE: Record<string, string[]> = {
  agent_settings: ['max_concurrent_conversations', 'updated_at'],
  api_keys: [
    'deleted_at',
    'expires_at',
    'last_used_at',
    'name',
    'revoked_at',
    'scopes',
    'updated_at',
  ],
  channel_accounts: [
    'access_token_enc',
    'access_token_expires_at',
    'app_secret_enc',
    'deleted_at',
    'display_name',
    'key_version',
    'last_error',
    'last_refreshed_at',
    'oa_secret_key_enc',
    'refresh_claimed_at',
    'refresh_token_enc',
    'refresh_token_expires_at',
    'status',
    'team_id',
    'updated_at',
  ],
  conversations: [
    'after_hours_hold',
    'assigned_user_id',
    'closed_at',
    'customer_id',
    'last_customer_message_at',
    'last_message_at',
    'last_message_kind',
    'last_message_preview',
    'outcome',
    'priority',
    'state',
    'updated_at',
    'version',
  ],
  customers: ['deleted_at', 'display_name', 'email', 'human_only', 'phone_e164', 'updated_at'],
  feature_flags_overrides: ['enabled', 'updated_at'],
  // created_at on purpose: a key used again after 24 hours starts its day anew (N134).
  idempotency_keys: [
    'created_at',
    'method',
    'path',
    'request_hash',
    'response_body',
    'response_status',
    'status',
    'updated_at',
  ],
  inbound_events: [
    'attempts',
    'available_at',
    'claimed_at',
    'last_error',
    'processed_at',
    'status',
  ],
  message_deliveries: [
    'attempts',
    'last_error',
    'platform_message_id',
    'sent_at',
    'status',
    'updated_at',
  ],
  org_members: [
    'deleted_at',
    'invite_expires_at',
    'invite_token_hash',
    'invited_email',
    'role',
    'status',
    'updated_at',
  ],
  organizations: ['deleted_at', 'name', 'slug', 'updated_at'],
  outbox_events: ['attempts', 'available_at', 'claimed_at', 'last_error', 'published_at', 'status'],
  quick_replies: ['body', 'deleted_at', 'shortcut', 'tags', 'updated_at', 'use_count'],
  bot_flows: ['deleted_at', 'name', 'status', 'updated_at', 'version'],
  bot_flow_versions: ['published_at', 'published_by', 'status', 'updated_at', 'version'],
  bot_sessions: [
    'awaiting',
    'current_node_key',
    'ended_at',
    'recent_steps',
    'status',
    'step_count',
    'updated_at',
    'vars',
    'version',
    'version_id',
  ],
  team_members: ['deleted_at', 'updated_at'],
  teams: ['deleted_at', 'description', 'is_default', 'name', 'slug', 'updated_at'],
  workspace_members: ['deleted_at', 'updated_at'],
  workspaces: [
    'contact_phone',
    'default_max_concurrent',
    'deleted_at',
    'name',
    'slug',
    'template',
    'timezone',
    'updated_at',
  ],
};
const TABLES = `FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition`;

let admin: pg.Client;
beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
});
afterAll(() => admin.end());

describe('UPDATE of app_role', () => {
  it('is on exactly the listed columns, and never on a whole table', async () => {
    const { rows } = await admin.query<{ name: string; columns: string[] }>(
      `SELECT c.relname AS name, array_agg(a.attname::text ORDER BY a.attname) AS columns
       ${TABLES.replace('WHERE', 'JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped WHERE')}
         AND has_column_privilege('app_role', c.oid, a.attnum, 'UPDATE')
       GROUP BY c.relname ORDER BY c.relname`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.name, r.columns]))).toEqual(APP_UPDATE);
    const whole = await admin.query(
      `SELECT c.relname ${TABLES} AND has_table_privilege('app_role', c.oid, 'UPDATE')`,
    );
    expect(whole.rows).toEqual([]);
  });

  it('refuses an UPDATE of an identity column with 42501, before RLS or a trigger is asked', async () => {
    const app = new pg.Client({ connectionString: url('app') });
    await app.connect();
    try {
      for (const sql of [
        'UPDATE conversations SET org_id = org_id',
        'UPDATE conversations SET workspace_id = workspace_id',
        'UPDATE org_members SET user_id = user_id',
        'UPDATE workspaces SET created_by = created_by',
      ])
        await expect(app.query(sql), sql).rejects.toMatchObject({ code: '42501' });
    } finally {
      await app.end();
    }
  });
});

describe('SELECT of support_role on conversations (DBM-01)', () => {
  it('leaves out external_user_id, the Zalo id of the customer, and the line of the Inbox (U30, N169), and shows the rest', async () => {
    const { rows } = await admin.query<{ column: string; ok: boolean }>(
      `SELECT a.attname AS column, has_column_privilege('support_role', a.attrelid, a.attnum, 'SELECT') AS ok
       FROM pg_attribute a WHERE a.attrelid = 'public.conversations'::regclass AND a.attnum > 0 AND NOT a.attisdropped`,
    );
    expect(rows.filter((r) => !r.ok).map((r) => r.column)).toEqual([
      'external_user_id',
      'last_message_preview',
      'last_message_kind',
    ]);
    expect(rows.length).toBeGreaterThan(10);
  });
});

describe('SELECT of support_role on customers (N165)', () => {
  it('leaves out every personal column: name, phone, email and the external id of an identity', async () => {
    const { rows } = await admin.query<{ name: string; columns: string[] }>(
      `SELECT c.relname AS name, array_agg(a.attname::text ORDER BY a.attname) AS columns
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
       WHERE c.relname IN ('customers', 'customer_identities') AND c.relnamespace = 'public'::regnamespace
         AND a.attnum > 0 AND NOT a.attisdropped AND NOT has_column_privilege('support_role', a.attrelid, a.attnum, 'SELECT')
       GROUP BY c.relname ORDER BY c.relname`,
    );
    expect(rows).toEqual([
      { name: 'customer_identities', columns: ['external_id'] },
      { name: 'customers', columns: ['display_name', 'email', 'phone_e164'] },
    ]);
  });
});
