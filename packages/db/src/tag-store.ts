import { uuidv7 } from '@gani/domain';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { customers } from './schema/customers.js';
import { customerTags, tags } from './schema/tags.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// The tags of the transaction's organisation (J4, T-4/U47, N190; Tag 3a): one set for the whole company. Who may make, rename, hide or
// merge one (an Owner or an Admin) is the caller's check. Nothing is deleted (spec RLS M01 §7 case 11): a merged tag ends with
// deleted_at and frees its name; a customer loses a tag by deleted_at on customer_tags too.

/** At most this many live tags a company (CEO 02/11/2026): counted under the company's tag lock, not by a constraint. */
export const TAG_LIMIT = 500;

/** The first key of the two-key lock of a company's tags (any constant other than the other lock spaces). */
const TAG_LOCK_SPACE = 7301;

export interface TagRow {
  readonly id: string;
  readonly name: string;
  readonly hidden: boolean;
  /** Live customers with this tag. */
  readonly customerCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TagChange {
  readonly name?: string;
  readonly hidden?: boolean;
}

/** Another live tag of the company has this name, whatever the case (unique index tags_org_name_key). */
export class TagNameTakenError extends Error {
  constructor() {
    super('another tag of the company has this name');
    this.name = 'TagNameTakenError';
  }
}

/** The company has TAG_LIMIT live tags already. */
export class TagLimitError extends Error {
  constructor() {
    super('the company has the most tags it may have');
    this.name = 'TagLimitError';
  }
}

const customerCount = sql<number>`(
  SELECT count(*)::int FROM customer_tags ct JOIN customers c ON c.org_id = ct.org_id AND c.id = ct.customer_id
  WHERE ct.org_id = tags.org_id AND ct.tag_id = tags.id AND ct.deleted_at IS NULL AND c.deleted_at IS NULL)`;

const columns = {
  id: tags.id,
  name: tags.name,
  hidden: tags.hidden,
  customerCount,
  createdAt: tags.createdAt,
  updatedAt: tags.updatedAt,
};

/** Runs `fn` in a savepoint and turns a name taken (23505) into TagNameTakenError; the transaction goes on. */
async function nameFree<T>(tx: TenantTx, fn: (t: TenantTx) => Promise<T>): Promise<T> {
  try {
    return await tx.transaction(fn);
  } catch (error) {
    for (let e: unknown = error; e instanceof Error; e = e.cause)
      if ((e as { code?: unknown }).code === '23505') throw new TagNameTakenError();
    throw error;
  }
}

/** Every live tag of the company, by name, hidden ones too. */
export async function listTags(tx: TenantTx): Promise<TagRow[]> {
  return tx
    .select(columns)
    .from(tags)
    .where(isNull(tags.deletedAt))
    .orderBy(asc(sql`lower(${tags.name})`), asc(tags.id));
}

/** The live tags `ids`, locked until the end of the transaction (in id order, so two merges never deadlock). */
export async function lockTags(tx: TenantTx, ids: readonly string[]): Promise<TagRow[]> {
  if (ids.length === 0) return [];
  return tx
    .select(columns)
    .from(tags)
    .where(
      and(
        inArray(
          tags.id,
          ids.map((id) => assertUuid(id, 'id')),
        ),
        isNull(tags.deletedAt),
      ),
    )
    .orderBy(asc(tags.id))
    .for('update', { of: tags });
}

/** Makes a tag; TagLimitError at TAG_LIMIT, TagNameTakenError when its name is taken. */
export async function createTag(
  tx: TenantTx,
  q: { readonly id: string; readonly name: string },
): Promise<TagRow> {
  const id = assertUuid(q.id, 'id');
  const { orgId } = currentTenantContext();
  // One count at a time per company: two makers at 499 cannot both pass.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${TAG_LOCK_SPACE}, hashtext(${orgId}::text))`);
  const [live] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(tags)
    .where(isNull(tags.deletedAt));
  if ((live?.n ?? 0) >= TAG_LIMIT) throw new TagLimitError();
  await nameFree(tx, (t) => t.insert(tags).values({ id, orgId, name: q.name.normalize('NFC') }));
  return (await lockTags(tx, [id]))[0] as TagRow;
}

/** Renames or hides a tag locked before; TagNameTakenError when the new name is taken. */
export async function updateTag(tx: TenantTx, id: string, change: TagChange): Promise<TagRow> {
  const key = assertUuid(id, 'id');
  await nameFree(tx, (t) =>
    t
      .update(tags)
      .set({
        ...(change.name === undefined ? {} : { name: change.name.normalize('NFC') }),
        ...(change.hidden === undefined ? {} : { hidden: change.hidden }),
        updatedAt: sql`now()`,
      })
      .where(eq(tags.id, key)),
  );
  return (await lockTags(tx, [key]))[0] as TagRow;
}

/**
 * Merges the tag `fromId` into `intoId`, both locked before: every customer with `fromId` and not yet `intoId` gets it (a row that was
 * switched off is turned back on), then `fromId` is switched off for everyone and ends with deleted_at. Returns how many customers got
 * `intoId`; none is lost, none counted twice.
 */
export async function mergeTag(tx: TenantTx, fromId: string, intoId: string): Promise<number> {
  const from = assertUuid(fromId, 'fromId');
  const into = assertUuid(intoId, 'intoId');
  const { orgId } = currentTenantContext();
  const result = await tx.execute<{ customer_id: string; into_id: string | null }>(sql`
    SELECT s.customer_id, i.id AS into_id FROM customer_tags s
    LEFT JOIN customer_tags i ON i.org_id = s.org_id AND i.customer_id = s.customer_id AND i.tag_id = ${into}::uuid
    WHERE s.tag_id = ${from}::uuid AND s.deleted_at IS NULL AND (i.id IS NULL OR i.deleted_at IS NOT NULL)
    ORDER BY s.customer_id`);
  const rows = result.rows as { customer_id: string; into_id: string | null }[];
  const back = rows.flatMap((r) => (r.into_id ? [r.into_id] : []));
  const fresh = rows.filter((r) => !r.into_id).map((r) => r.customer_id);
  if (back.length > 0)
    await tx
      .update(customerTags)
      .set({ deletedAt: null, updatedAt: sql`now()` })
      .where(inArray(customerTags.id, back));
  if (fresh.length > 0)
    await tx
      .insert(customerTags)
      .values(fresh.map((customerId) => ({ id: uuidv7(), orgId, customerId, tagId: into })));
  await tx
    .update(customerTags)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(customerTags.tagId, from), isNull(customerTags.deletedAt)));
  await tx
    .update(tags)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(tags.id, from));
  return rows.length;
}

export interface CustomerTagRow {
  readonly id: string;
  readonly name: string;
  readonly hidden: boolean;
}

/** A tag named is not a live tag of the company (404). */
export class TagNotFoundError extends Error {
  constructor() {
    super('a tag is not of the company');
    this.name = 'TagNotFoundError';
  }
}

/** A hidden tag the customer does not have yet (422 tag_hidden, T-4): no customer gets a hidden tag any more. */
export class TagHiddenError extends Error {
  constructor() {
    super('a hidden tag cannot be given');
    this.name = 'TagHiddenError';
  }
}

/**
 * Sets the whole set of tags of the live customer `customerId`: the tags named are on, every other is switched off (deleted_at), a
 * switched-off one named again is turned back on. The customer is locked first (two sets of one customer queue), then the tags
 * involved FOR SHARE in id order, so a merge of one of them waits or is waited for, never half seen. Returns the customer's tags by
 * name, or null when there is no such live customer.
 */
export async function setCustomerTags(
  tx: TenantTx,
  customerId: string,
  tagIds: readonly string[],
): Promise<CustomerTagRow[] | null> {
  const customer = assertUuid(customerId, 'customerId');
  const [found] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, customer), isNull(customers.deletedAt)))
    .for('update');
  if (!found) return null;
  const wanted = new Set(tagIds.map((id) => assertUuid(id, 'tagId')));
  const links = await tx
    .select({ id: customerTags.id, tagId: customerTags.tagId, off: customerTags.deletedAt })
    .from(customerTags)
    .where(eq(customerTags.customerId, customer));
  const has = new Set(links.filter((l) => l.off === null).map((l) => l.tagId));
  const involved = [...new Set([...wanted, ...has])].sort();
  const live =
    involved.length === 0
      ? []
      : await tx
          .select({ id: tags.id, hidden: tags.hidden })
          .from(tags)
          .where(and(inArray(tags.id, involved), isNull(tags.deletedAt)))
          .orderBy(asc(tags.id))
          .for('share');
  for (const id of wanted) {
    const tag = live.find((t) => t.id === id);
    if (!tag) throw new TagNotFoundError();
    if (tag.hidden && !has.has(id)) throw new TagHiddenError();
  }
  const off = links.filter((l) => l.off === null && !wanted.has(l.tagId)).map((l) => l.id);
  const back = links.filter((l) => l.off !== null && wanted.has(l.tagId)).map((l) => l.id);
  const known = new Set(links.map((l) => l.tagId));
  const fresh = [...wanted].filter((id) => !known.has(id));
  if (off.length > 0)
    await tx
      .update(customerTags)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(inArray(customerTags.id, off));
  if (back.length > 0)
    await tx
      .update(customerTags)
      .set({ deletedAt: null, updatedAt: sql`now()` })
      .where(inArray(customerTags.id, back));
  if (fresh.length > 0) {
    const { orgId } = currentTenantContext();
    await tx
      .insert(customerTags)
      .values(fresh.map((tagId) => ({ id: uuidv7(), orgId, customerId: customer, tagId })));
  }
  return tx
    .select({ id: tags.id, name: tags.name, hidden: tags.hidden })
    .from(customerTags)
    .innerJoin(tags, and(eq(tags.orgId, customerTags.orgId), eq(tags.id, customerTags.tagId)))
    .where(
      and(
        eq(customerTags.customerId, customer),
        isNull(customerTags.deletedAt),
        isNull(tags.deletedAt),
      ),
    )
    .orderBy(asc(sql`lower(${tags.name})`), asc(tags.id));
}
