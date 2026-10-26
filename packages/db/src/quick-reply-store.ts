import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';

import { organizations } from './schema/organizations.js';
import { quickReplies } from './schema/quick-replies.js';
import { workspaces } from './schema/workspaces.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// The canned answers of a workspace (C7, spec-M8 §3.2, endpoint-M8 §2, N163). Row-level security keeps them to the transaction's
// organisation and workspaces; who may change them (an Owner, an Admin or a Manager) and which variables a body may hold are the
// caller's checks. Nothing is deleted: a template ends with deleted_at and gives its shortcut back.

export interface QuickReplyRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly shortcut: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly useCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** What may change of a template. */
export interface QuickReplyChange {
  readonly shortcut?: string;
  readonly body?: string;
  readonly tags?: readonly string[];
}

/** The shortcut is the one of another live template of the workspace (unique index quick_replies_shortcut_key). */
export class QuickReplyShortcutTakenError extends Error {
  constructor() {
    super('another template of the workspace has this shortcut');
    this.name = 'QuickReplyShortcutTakenError';
  }
}

const columns = {
  id: quickReplies.id,
  workspaceId: quickReplies.workspaceId,
  shortcut: quickReplies.shortcut,
  body: quickReplies.body,
  tags: quickReplies.tags,
  useCount: quickReplies.useCount,
  createdAt: quickReplies.createdAt,
  updatedAt: quickReplies.updatedAt,
};

/** Runs `fn` in a savepoint and turns a duplicate shortcut (23505) into QuickReplyShortcutTakenError; the transaction goes on. */
async function shortcutFree<T>(tx: TenantTx, fn: (t: TenantTx) => Promise<T>): Promise<T> {
  try {
    return await tx.transaction(fn);
  } catch (error) {
    for (let e: unknown = error; e instanceof Error; e = e.cause)
      if ((e as { code?: unknown }).code === '23505') throw new QuickReplyShortcutTakenError();
    throw error;
  }
}

/**
 * The live templates of a workspace, most used first: with `q`, those whose shortcut starts with it (what the agent typed after "/");
 * with `tag`, those that carry it.
 */
export async function listQuickReplies(
  tx: TenantTx,
  q: { readonly workspaceId: string; readonly q?: string; readonly tag?: string },
): Promise<QuickReplyRow[]> {
  const where: SQL[] = [
    eq(quickReplies.workspaceId, assertUuid(q.workspaceId, 'workspaceId')),
    isNull(quickReplies.deletedAt),
  ];
  // starts_with: what was typed is a value, never a LIKE pattern.
  if (q.q) where.push(sql`starts_with(${quickReplies.shortcut}, ${q.q})`);
  if (q.tag) where.push(sql`${quickReplies.tags} @> ARRAY[${q.tag}]::text[]`);
  return tx
    .select(columns)
    .from(quickReplies)
    .where(and(...where))
    .orderBy(desc(quickReplies.useCount), asc(quickReplies.shortcut))
    .limit(200);
}

/** The live template `id`, locked until the end of the transaction, or null. */
export async function lockQuickReply(tx: TenantTx, id: string): Promise<QuickReplyRow | null> {
  const [row] = await tx
    .select(columns)
    .from(quickReplies)
    .where(and(eq(quickReplies.id, assertUuid(id, 'id')), isNull(quickReplies.deletedAt)))
    .for('update');
  return row ?? null;
}

/** Makes a template in a workspace of the transaction; QuickReplyShortcutTakenError when its shortcut is taken. */
export async function createQuickReply(
  tx: TenantTx,
  q: {
    readonly id: string;
    readonly workspaceId: string;
    readonly shortcut: string;
    readonly body: string;
    readonly tags: readonly string[];
    readonly createdBy: string;
  },
): Promise<QuickReplyRow> {
  const id = assertUuid(q.id, 'id');
  await shortcutFree(tx, (t) =>
    t.insert(quickReplies).values({
      id,
      orgId: currentTenantContext().orgId,
      workspaceId: assertUuid(q.workspaceId, 'workspaceId'),
      shortcut: q.shortcut,
      body: q.body,
      tags: [...q.tags],
      createdBy: q.createdBy,
    }),
  );
  return (await lockQuickReply(tx, id)) as QuickReplyRow;
}

/** Applies `change` to a template locked before; QuickReplyShortcutTakenError when the new shortcut is taken. */
export async function updateQuickReply(
  tx: TenantTx,
  id: string,
  change: QuickReplyChange,
): Promise<QuickReplyRow> {
  const key = assertUuid(id, 'id');
  const { tags, ...rest } = change;
  await shortcutFree(tx, (t) =>
    t
      .update(quickReplies)
      .set({ ...rest, ...(tags ? { tags: [...tags] } : {}), updatedAt: sql`now()` })
      .where(eq(quickReplies.id, key)),
  );
  return (await lockQuickReply(tx, key)) as QuickReplyRow;
}

/** Ends a template locked before (deleted_at): its shortcut is free again. */
export async function deleteQuickReply(tx: TenantTx, id: string): Promise<void> {
  await tx
    .update(quickReplies)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(quickReplies.id, assertUuid(id, 'id')));
}

/** Counts one use of the live template `id` (the Inbox sent it); its new count, or null when there is no such template. */
export async function countQuickReplyUse(tx: TenantTx, id: string): Promise<number | null> {
  const [row] = await tx
    .update(quickReplies)
    .set({ useCount: sql`${quickReplies.useCount} + 1` })
    .where(and(eq(quickReplies.id, assertUuid(id, 'id')), isNull(quickReplies.deletedAt)))
    .returning({ useCount: quickReplies.useCount });
  return row?.useCount ?? null;
}

/**
 * What the variables of a template become in a workspace, for the preview of /settings/quick-replies (endpoint-M8 §2, N163): the name of
 * the company, the contact number of the workspace (N163) and the name of the person `userId` (app.org_users, no email). Null where the
 * value is not set: the preview names it as unresolved.
 */
export async function templateValues(
  tx: TenantTx,
  q: { readonly workspaceId: string; readonly userId: string },
): Promise<{ companyName: string | null; companyPhone: string | null; agentName: string | null }> {
  const [org] = await tx
    .select({ name: organizations.name })
    .from(organizations)
    .where(isNull(organizations.deletedAt));
  const [workspace] = await tx
    .select({ phone: workspaces.contactPhone })
    .from(workspaces)
    .where(eq(workspaces.id, assertUuid(q.workspaceId, 'workspaceId')));
  const people = await tx.execute<{ display_name: string | null }>(
    sql`SELECT display_name FROM app.org_users WHERE user_id = ${assertUuid(q.userId, 'userId')}::uuid`,
  );
  const name = (
    people.rows[0] as { display_name: string | null } | undefined
  )?.display_name?.trim();
  return {
    companyName: org?.name ?? null,
    companyPhone: workspace?.phone ?? null,
    agentName: name || null,
  };
}
