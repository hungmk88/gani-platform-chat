import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { url } from './db.js';

// ADR-004 keeps a closed list of SECURITY DEFINER functions (N125, review G-01): a new one needs a row there and an N-number. This is
// the list as code, so a migration that adds one fails here until both are written.
const ADR_004 = [
  'app.accept_invite',
  'app.channel_account_for_webhook',
  'app.ensure_log_partitions',
  'app.inbound_pending_orgs',
  'app.log_default_partition_rows',
  'app.lookup_invite',
  'app.memberships_for_user',
  'app.outbox_pending_orgs',
  'app.outbox_stats',
  'app.purge_idempotency_keys',
  'app.purge_inbound_event_keys',
  'app.reset_member_two_factor',
  'app.support_access_ok',
];

let admin: pg.Client;
beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
});
afterAll(() => admin.end());

describe('SECURITY DEFINER functions', () => {
  it('are exactly the ones ADR-004 lists, and each pins its search_path', async () => {
    const { rows } = await admin.query<{ name: string; pinned: boolean }>(
      `SELECT n.nspname || '.' || p.proname AS name, coalesce(p.proconfig::text LIKE '%search_path=%', false) AS pinned
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema') ORDER BY 1`,
    );
    expect(rows.map((r) => r.name)).toEqual(ADR_004);
    expect(rows.filter((r) => !r.pinned)).toEqual([]);
  });
});
