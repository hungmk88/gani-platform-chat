import { sql } from 'drizzle-orm';

import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// The flows a customer's message can start (D1b3a, Brief P13, N184): the active, live flows of a workspace, each with its latest
// published version and the config of that version's trigger, the flow changed last first. The worker picks one (keyword before
// first message) and starts a session on the version. Row-level security keeps the organisation's flows; the workspace is a filter.

export interface BotTriggerRow {
  readonly flowId: string;
  readonly versionId: string;
  readonly trigger: Readonly<Record<string, unknown>>;
}

export async function listBotTriggers(
  tx: TenantTx,
  workspaceId: string,
): Promise<readonly BotTriggerRow[]> {
  const rows = await tx.execute<{ flow_id: string; version_id: string; trigger: unknown }>(sql`
    SELECT f.id AS flow_id, v.id AS version_id, n.config AS trigger
    FROM bot_flows f
    JOIN bot_flow_versions v ON v.org_id = f.org_id AND v.flow_id = f.id AND v.status = 'published'
      AND v.version = (SELECT max(p.version) FROM bot_flow_versions p WHERE p.org_id = f.org_id AND p.flow_id = f.id)
    JOIN bot_nodes n ON n.org_id = v.org_id AND n.version_id = v.id AND n.type = 'trigger'
    WHERE f.workspace_id = ${assertUuid(workspaceId, 'workspaceId')} AND f.status = 'active' AND f.deleted_at IS NULL
    ORDER BY f.updated_at DESC, f.id DESC`);
  return rows.rows.map((r) => ({
    flowId: r.flow_id,
    versionId: r.version_id,
    trigger: r.trigger as Readonly<Record<string, unknown>>,
  }));
}
