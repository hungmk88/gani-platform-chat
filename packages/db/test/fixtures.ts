import { randomBytes } from 'node:crypto';

import { uuidv7 } from '@gani/domain';
import type pg from 'pg';

// Child tables first: cleanup deletes in this order, then the user and the organization.
const TENANT_TABLES = [
  'messages',
  'conversations',
  'feature_flags_overrides',
  'agent_settings',
  'audit_logs',
  'platform_access_logs',
  'api_keys',
  'team_members',
  'teams',
  'workspace_members',
  'workspaces',
  'org_members',
];

/** Key of the global flag that seedTenant creates for an organization (flag keys are global, so one per org). */
export const flagKeyOf = (org: string) => `f_${org.replaceAll('-', '')}`;

/** Inserts an organization and one row in every RLS table (as migration_role); returns the id of its user. */
export async function seedTenant(admin: pg.Client, org: string): Promise<string> {
  const [user, workspace, team, conversation] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
  // Every value is generated here (UUIDs, random hex), never client input.
  await admin.query(`
    INSERT INTO organizations (id, slug, name) VALUES ('${org}', 't-${org}', 'T');
    INSERT INTO users (id, email, status) VALUES ('${user}', '${user}@example.test', 'active');
    INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ('${uuidv7()}', '${org}', '${user}', 'owner', 'active');
    INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ('${workspace}', '${org}', 'ws', 'W', 'service');
    INSERT INTO workspace_members (id, org_id, workspace_id, user_id) VALUES ('${uuidv7()}', '${org}', '${workspace}', '${user}');
    INSERT INTO teams (id, org_id, workspace_id, name, slug) VALUES ('${team}', '${org}', '${workspace}', 'T', 'tm');
    INSERT INTO team_members (id, org_id, team_id, user_id) VALUES ('${uuidv7()}', '${org}', '${team}', '${user}');
    INSERT INTO api_keys (id, org_id, name, key_prefix, key_hash, scopes) VALUES ('${uuidv7()}', '${org}', 'k', 'gk_${randomBytes(4).toString('hex')}', decode('${randomBytes(32).toString('hex')}', 'hex'), '{conversations}');
    INSERT INTO audit_logs (id, org_id, action) VALUES ('${uuidv7()}', '${org}', 'seed');
    INSERT INTO feature_flags_global (key, description, owner, remove_by) VALUES ('${flagKeyOf(org)}', 'seed', 'seed', current_date + 30);
    INSERT INTO feature_flags_overrides (id, org_id, workspace_id, flag_key, enabled) VALUES ('${uuidv7()}', '${org}', '${workspace}', '${flagKeyOf(org)}', true);
    INSERT INTO agent_settings (id, org_id, user_id) VALUES ('${uuidv7()}', '${org}', '${user}');
    INSERT INTO conversations (id, org_id, workspace_id, state) VALUES ('${conversation}', '${org}', '${workspace}', 'BOT_ACTIVE');
    INSERT INTO messages (id, org_id, workspace_id, conversation_id, sequence_number, sender_kind, kind, body) VALUES ('${uuidv7()}', '${org}', '${workspace}', '${conversation}', 1, 'customer', 'text', 'seed');
    INSERT INTO platform_access_logs (id, org_id, operator_user_id, db_login, reason, expires_at) VALUES ('${uuidv7()}', '${org}', '${user}', 'seed_login', 'seed', now() + interval '30 minutes')`);
  return user;
}

/** Removes what seedTenant made. A failing step never throws: the CI database is thrown away after the job. */
export async function cleanupTenant(admin: pg.Client, org: string, user: string): Promise<void> {
  const steps = [
    ...TENANT_TABLES.map((t) => `DELETE FROM ${t} WHERE org_id = '${org}'`),
    `DELETE FROM feature_flags_global WHERE key = '${flagKeyOf(org)}'`,
    `DELETE FROM users WHERE id = '${user}'`,
    `DELETE FROM organizations WHERE id = '${org}'`,
  ];
  for (const step of steps) await admin.query(step).catch(() => undefined);
}
