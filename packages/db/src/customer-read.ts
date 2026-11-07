import { and, desc, eq, ilike, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';

import { cursorString, decodeCursor, encodeCursor } from './cursor.js';
import { customers } from './schema/customers.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// What the Khách hàng screens read (J1, Brief P9 `GET /v1/customers`, N165): the live customers of the transaction's organisation,
// newest first. Who sees a phone or an email whole is the API's decision (Phụ lục B "Xem SĐT đầy đủ"); nothing here logs them.

export interface CustomerIdentityView {
  readonly type: 'zalo_uid';
  readonly channelAccountId: string | null;
  readonly verification: 'verified' | 'unverified' | 'sales_confirmed';
}

export interface CustomerView {
  readonly id: string;
  readonly displayName: string | null;
  readonly phoneE164: string | null;
  readonly email: string | null;
  readonly humanOnly: boolean;
  /** How the channels know the customer; never the external id (a Zalo user id is an identifier, N69). */
  readonly identities: readonly CustomerIdentityView[];
  /** The customer's live tags by name, hidden ones too (T-4, N190). */
  readonly tags: readonly {
    readonly id: string;
    readonly name: string;
    readonly hidden: boolean;
  }[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CustomerListQuery {
  /** A part of the name, any case. */
  readonly name?: string;
  /** The start of a number in E.164 (phonePrefix of @gani/domain). */
  readonly phonePrefix?: string;
  /** A whole email, lower case: equal, never a part (U48), so a search cannot spell out an address (index customers_org_email_idx). */
  readonly email?: string;
  /** Only the customers who have this live tag (N190); a hidden tag still filters (T-4). */
  readonly tagId?: string;
  readonly cursor?: string;
  /** 1..100 (P9). */
  readonly limit: number;
}

const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The identities of the row: the outer table is named in full, as Drizzle would write its columns unqualified inside the subquery.
const view = {
  id: customers.id,
  displayName: customers.displayName,
  phoneE164: customers.phoneE164,
  email: customers.email,
  humanOnly: customers.humanOnly,
  identities: sql<CustomerIdentityView[]>`coalesce((
    SELECT json_agg(json_build_object('type', i.identity_type, 'channelAccountId', i.channel_account_id,
      'verification', i.verification) ORDER BY i.created_at, i.id)
    FROM customer_identities i WHERE i.org_id = customers.org_id AND i.customer_id = customers.id), '[]'::json)`,
  tags: sql<CustomerView['tags']>`coalesce((
    SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'hidden', t.hidden) ORDER BY lower(t.name), t.id)
    FROM customer_tags ct JOIN tags t ON t.org_id = ct.org_id AND t.id = ct.tag_id
    WHERE ct.org_id = customers.org_id AND ct.customer_id = customers.id AND ct.deleted_at IS NULL AND t.deleted_at IS NULL),
    '[]'::json)`,
  createdAt: customers.createdAt,
  updatedAt: customers.updatedAt,
};

/** `%` and `_` of a search are letters, not wildcards. */
const literal = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** One search of customers (N165, U48), as searchOf of the API picks it from `q`; the Khách hàng list and the Inbox share it. */
export type CustomerSearch =
  { readonly name: string } | { readonly phonePrefix: string } | { readonly email: string };

/**
 * The condition on `customers` of a search: a part of the name, any case, `%` and `_` taken literally, `q` in NFC as every stored name is
 * (customers_display_name_nfc_check); the start of the E.164 number; the whole email, equal.
 */
export function customerSearchWhere(s: CustomerSearch): SQL {
  if ('email' in s) return eq(customers.email, s.email);
  if ('phonePrefix' in s) return sql`starts_with(${customers.phoneE164}, ${s.phonePrefix})`;
  return ilike(customers.displayName, `%${literal(s.name.normalize('NFC'))}%`);
}

/** One live customer of the organisation, or null (another organisation's is hidden by RLS). */
export async function loadCustomer(tx: TenantTx, id: string): Promise<CustomerView | null> {
  const [row] = await tx
    .select(view)
    .from(customers)
    .where(
      and(
        eq(customers.id, assertUuid(id, 'id')),
        isNull(customers.deletedAt),
        // A merged customer is hidden (J3, N204): its profile is the target's now.
        isNull(customers.mergedInto),
      ),
    );
  return row ?? null;
}

/** Why a customer is suggested for a merge (J3d): the same phone (E.164) or the same email, exactly. */
export type MergeSuggestionReason = 'phone' | 'email';

/**
 * The live, unmerged customers of the organisation with exactly the same phone or email as `id` (J3d, contract J3-0): never a part of
 * one, never the customer itself; at most 20, newest first. Null when `id` is not a live customer. The values are compared in SQL and
 * never logged.
 */
export async function listMergeSuggestions(
  tx: TenantTx,
  id: string,
): Promise<
  { readonly customer: CustomerView; readonly reasons: readonly MergeSuggestionReason[] }[] | null
> {
  const self = await loadCustomer(tx, id);
  if (self === null) return null;
  const same: SQL[] = [];
  if (self.phoneE164 !== null) same.push(eq(customers.phoneE164, self.phoneE164));
  if (self.email !== null) same.push(eq(customers.email, self.email));
  if (same.length === 0) return [];
  const rows = await tx
    .select(view)
    .from(customers)
    .where(
      and(
        ne(customers.id, self.id),
        isNull(customers.deletedAt),
        isNull(customers.mergedInto),
        or(...same),
      ),
    )
    .orderBy(desc(customers.id))
    .limit(20);
  return rows.map((customer) => ({
    customer,
    reasons: [
      ...(self.phoneE164 !== null && customer.phoneE164 === self.phoneE164
        ? ['phone' as const]
        : []),
      ...(self.email !== null && customer.email === self.email ? ['email' as const] : []),
    ],
  }));
}

/**
 * ONLY for the answer of an unmerge (J3c, CEO 07/11/2026): the target may have been soft deleted since the merge (N205), and the
 * contract answers it whole. The fields are those of every other read; `deleted` is for the caller's audit, never for the answer.
 */
export async function loadCustomerForUnmerge(
  tx: TenantTx,
  id: string,
): Promise<{ readonly customer: CustomerView; readonly deleted: boolean } | null> {
  const [row] = await tx
    .select({ ...view, deleted: sql<boolean>`${customers.deletedAt} IS NOT NULL` })
    .from(customers)
    .where(eq(customers.id, assertUuid(id, 'id')));
  if (row === undefined) return null;
  const { deleted, ...customer } = row;
  return { customer, deleted };
}

/** The live customers, newest first (UUIDv7 ids, index customers_org_id_idx), by keyset on the id. */
export async function listCustomers(
  tx: TenantTx,
  q: CustomerListQuery,
): Promise<{ readonly rows: readonly CustomerView[]; readonly nextCursor: string | null }> {
  if (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > 100)
    throw new RangeError('limit must be 1..100');
  const c = customers;
  const where: (SQL | undefined)[] = [isNull(c.deletedAt), isNull(c.mergedInto)];
  if (q.name !== undefined) where.push(customerSearchWhere({ name: q.name }));
  if (q.phonePrefix !== undefined) where.push(customerSearchWhere({ phonePrefix: q.phonePrefix }));
  if (q.email !== undefined) where.push(customerSearchWhere({ email: q.email }));
  if (q.tagId !== undefined)
    where.push(sql`EXISTS (SELECT 1 FROM customer_tags ct WHERE ct.org_id = ${c.orgId} AND ct.customer_id = ${c.id}
      AND ct.tag_id = ${assertUuid(q.tagId, 'tagId')}::uuid AND ct.deleted_at IS NULL)`);
  if (q.cursor !== undefined)
    where.push(lt(c.id, cursorString(decodeCursor(q.cursor), 'id', UUID_FORMAT)));
  const rows = await tx
    .select(view)
    .from(c)
    .where(and(...where))
    .orderBy(desc(c.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return {
    rows: page,
    nextCursor: rows.length > q.limit && last ? encodeCursor({ id: last.id }) : null,
  };
}
