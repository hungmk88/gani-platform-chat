// Backfill of the line of the Inbox (U30, N169): fills conversations.last_message_kind / last_message_preview for conversations whose
// messages came before 202610291000, from their last message that is not an event of the system, cut by the same messagePreview as
// insertMessage. Usage (packages/db/CLAUDE.md "Điền lại đoạn trích"):
//   APP_ENV=... DATABASE_URL_MIGRATION=... node scripts/backfill-last-message-preview.mjs [--dry-run] [--org <uuid>]
// As migration_role (BYPASSRLS): one pass over every organisation, in batches of conversations by id, one transaction each. Runs again
// safely: it only takes conversations that have a message and no preview, and its UPDATE keeps `last_message_kind IS NULL`, so a newer
// message that insertMessage wrote meanwhile is never overwritten. Logs counts only: never a text, a customer or a conversation.
import console from 'node:console';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { messagePreview } from '@gani/domain';
import pg from 'pg';

export const BATCH_SIZE = 1000;
const NAME = 'backfill-last-message-preview';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// $1: one organisation, or null for all of them. Conversations that still lack a preview of a message they have.
const PENDING = `c.last_message_at IS NOT NULL AND c.last_message_kind IS NULL AND ($1::uuid IS NULL OR c.org_id = $1)`;

/** Fill the previews, or with `dryRun` only count the conversations it would take. */
export async function backfillLastMessagePreview({
  connectionString,
  orgId = null,
  dryRun = false,
  batchSize = BATCH_SIZE,
  log = console.log,
}) {
  if (!Number.isInteger(batchSize) || batchSize < 1)
    throw new Error('batchSize must be a whole number above 0');
  if (orgId !== null && !UUID.test(orgId)) throw new Error('orgId must be a UUID');
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM conversations c WHERE ${PENDING}`,
      [orgId],
    );
    const total = rows[0].n;
    if (dryRun) {
      log(`${NAME}: dry run, ${total} conversation(s) to fill, nothing written`);
      return { total, processed: 0, updated: 0, dryRun: true };
    }
    const started = Date.now();
    let [processed, updated, after] = [0, 0, '00000000-0000-0000-0000-000000000000'];
    for (;;) {
      await client.query('BEGIN');
      try {
        // The last message that is not an event of the system: one probe of the index (org_id, conversation_id, sequence_number) of
        // each monthly partition, newest first.
        const batch = await client.query(
          `SELECT c.id, m.kind, m.body
           FROM conversations c
           LEFT JOIN LATERAL (
             SELECT kind, body FROM messages m
             WHERE m.org_id = c.org_id AND m.conversation_id = c.id AND m.sender_kind <> 'system' AND m.kind <> 'system'
             ORDER BY m.sequence_number DESC LIMIT 1
           ) m ON true
           WHERE ${PENDING} AND c.id > $2
           ORDER BY c.id LIMIT $3`,
          [orgId, after, batchSize],
        );
        if (batch.rowCount === 0) {
          await client.query('COMMIT');
          break;
        }
        // A conversation of system events only keeps no preview, as insertMessage would.
        const fill = batch.rows.filter((r) => r.kind !== null);
        const result = await client.query(
          `UPDATE conversations c SET last_message_kind = v.kind, last_message_preview = v.preview
           FROM unnest($1::uuid[], $2::text[], $3::text[]) AS v(id, kind, preview)
           WHERE c.id = v.id AND c.last_message_kind IS NULL`,
          [
            fill.map((r) => r.id),
            fill.map((r) => r.kind),
            fill.map((r) => messagePreview(r.kind, r.body)),
          ],
        );
        await client.query('COMMIT');
        processed += batch.rowCount;
        updated += result.rowCount;
        after = batch.rows[batch.rowCount - 1].id;
        const seconds = (Date.now() - started) / 1000;
        const eta = processed >= total ? 0 : (seconds / processed) * (total - processed);
        log(`${NAME}: processed ${processed}/${total}, ETA ${Math.ceil(eta)}s`);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    }
    log(`${NAME}: done, ${updated} preview(s) filled of ${processed} conversation(s)`);
    return { total, processed, updated, dryRun: false };
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const at = args.indexOf('--org');
  const orgId = at === -1 ? null : (args[at + 1] ?? '');
  const known = args.every(
    (a, i) => a === '--dry-run' || a === '--org' || (at !== -1 && i === at + 1),
  );
  const connectionString = process.env.DATABASE_URL_MIGRATION;
  const appEnv = process.env.APP_ENV;
  if (!known || (orgId !== null && !UUID.test(orgId))) {
    console.error(`${NAME}: usage: [--dry-run] [--org <uuid>]`);
    process.exitCode = 2;
  } else if (!appEnv) {
    console.error(`${NAME}: APP_ENV is not set: say which environment this runs on`);
    process.exitCode = 2;
  } else if (!connectionString) {
    console.error(`${NAME}: DATABASE_URL_MIGRATION is not set`);
    process.exitCode = 2;
  } else {
    console.log(`${NAME}: APP_ENV=${appEnv}, ${orgId ? 'one organisation' : 'every organisation'}`);
    backfillLastMessagePreview({ connectionString, orgId, dryRun }).catch((error) => {
      console.error(`${NAME}: ${error.message}`);
      process.exitCode = 1;
    });
  }
}
