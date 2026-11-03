import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { customerFieldDefs } from './schema/customer-fields.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// The custom fields of a company's customers (J1, Tag 3b-i, N191; CEO 03/11/2026): their definitions. Row-level security keeps them to
// the transaction's organisation; who may change them is the caller's check. Their values are customer-field-value-store.ts. Nothing is
// deleted (spec RLS M01 §7 case 11): a field ends with deleted_at.

/** At most this many live fields a company (U46, CEO 02/11/2026): counted under the company's field lock, not by a constraint. */
export const FIELD_LIMIT = 50;

/** The first key of the two-key lock of a company's fields (any constant other than the other lock spaces). */
const FIELD_LOCK_SPACE = 7302;

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'phone' | 'email';

export interface FieldRow {
  readonly id: string;
  readonly name: string;
  readonly type: FieldType;
  readonly options: readonly string[];
  readonly required: boolean;
  readonly sensitive: boolean;
  readonly hidden: boolean;
  readonly position: number;
  /** Some customer has a value. */
  readonly hasData: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** The company has FIELD_LIMIT live fields already (422 field_limit_reached). */
export class FieldLimitError extends Error {
  constructor() {
    super('the company has the most fields it may have');
    this.name = 'FieldLimitError';
  }
}

/** The change needs a field without data: its type or sensitivity, a choice in use, or its end (409 field_has_data). */
export class FieldHasDataError extends Error {
  constructor() {
    super('the field has data');
    this.name = 'FieldHasDataError';
  }
}

const hasData = sql<boolean>`EXISTS (
  SELECT 1 FROM customer_field_values v
  WHERE v.org_id = customer_field_defs.org_id AND v.field_id = customer_field_defs.id
    AND (v.value IS NOT NULL OR v.value_enc IS NOT NULL))`;

const columns = {
  id: customerFieldDefs.id,
  name: customerFieldDefs.name,
  type: customerFieldDefs.type,
  options: customerFieldDefs.options,
  required: customerFieldDefs.required,
  sensitive: customerFieldDefs.sensitive,
  hidden: customerFieldDefs.hidden,
  position: customerFieldDefs.position,
  hasData,
  createdAt: customerFieldDefs.createdAt,
  updatedAt: customerFieldDefs.updatedAt,
};
const asRow = (row: Omit<FieldRow, 'type'> & { type: string }): FieldRow => row as FieldRow;
/** A field not ended (shared with customer-field-value-store.ts). */
export const liveField = isNull(customerFieldDefs.deletedAt);
const live = liveField;

/** Every live field of the company, by position, hidden ones too. */
export async function listFields(tx: TenantTx): Promise<FieldRow[]> {
  const rows = await tx
    .select(columns)
    .from(customerFieldDefs)
    .where(live)
    .orderBy(asc(customerFieldDefs.position), asc(customerFieldDefs.id));
  return rows.map(asRow);
}

/** The live field `id`, locked until the end of the transaction, or null. */
export async function lockField(tx: TenantTx, id: string): Promise<FieldRow | null> {
  const [row] = await tx
    .select(columns)
    .from(customerFieldDefs)
    .where(and(eq(customerFieldDefs.id, assertUuid(id, 'id')), live))
    .for('update', { of: customerFieldDefs });
  return row ? asRow(row) : null;
}

/** Makes a field, last in the order; FieldLimitError at FIELD_LIMIT. */
export async function createField(
  tx: TenantTx,
  q: {
    readonly id: string;
    readonly name: string;
    readonly type: FieldType;
    readonly options: readonly string[];
    readonly required: boolean;
    readonly sensitive: boolean;
  },
): Promise<FieldRow> {
  const id = assertUuid(q.id, 'id');
  const { orgId } = currentTenantContext();
  // One count at a time per company: two makers at 49 cannot both pass.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${FIELD_LOCK_SPACE}, hashtext(${orgId}::text))`,
  );
  const [count] = await tx
    .select({
      n: sql<number>`count(*)::int`,
      last: sql<number>`coalesce(max(position) + 1, 0)::int`,
    })
    .from(customerFieldDefs)
    .where(live);
  if ((count?.n ?? 0) >= FIELD_LIMIT) throw new FieldLimitError();
  await tx.insert(customerFieldDefs).values({
    id,
    orgId,
    name: q.name.normalize('NFC'),
    type: q.type,
    options: [...q.options],
    required: q.required,
    sensitive: q.sensitive,
    position: count?.last ?? 0,
  });
  return (await lockField(tx, id)) as FieldRow;
}

/** Whether a live value of the field (not encrypted) holds one of `choices`. */
async function choicesInUse(tx: TenantTx, fieldId: string, choices: readonly string[]) {
  if (choices.length === 0) return false;
  const list = sql`ARRAY[${sql.join(
    choices.map((c) => sql`${c}`),
    sql`, `,
  )}]::text[]`;
  const result = await tx.execute<{ used: boolean }>(sql`
    SELECT EXISTS (SELECT 1 FROM customer_field_values v
      WHERE v.field_id = ${fieldId}::uuid AND v.value IS NOT NULL
        AND ((jsonb_typeof(v.value) = 'string' AND v.value #>> '{}' = ANY(${list}))
          OR (jsonb_typeof(v.value) = 'array' AND v.value ?| ${list}))) AS used`);
  const [row] = result.rows as { used: boolean }[];
  return row?.used ?? false;
}

/**
 * Changes a field locked before (`current`). With data, its type and sensitivity stay and a choice in use stays (FieldHasDataError): a
 * sensitive field's values are encrypted and cannot be looked into, so with data none of its choices goes.
 */
export async function updateField(
  tx: TenantTx,
  current: FieldRow,
  change: {
    readonly name?: string;
    readonly type?: FieldType;
    readonly options?: readonly string[];
    readonly required?: boolean;
    readonly sensitive?: boolean;
    readonly hidden?: boolean;
    readonly position?: number;
  },
): Promise<FieldRow> {
  if (current.hasData) {
    if (change.type !== undefined && change.type !== current.type) throw new FieldHasDataError();
    if (change.sensitive !== undefined && change.sensitive !== current.sensitive)
      throw new FieldHasDataError();
    if (change.options !== undefined) {
      const removed = current.options.filter((o) => !change.options!.includes(o));
      if (
        removed.length > 0 &&
        (current.sensitive || (await choicesInUse(tx, current.id, removed)))
      )
        throw new FieldHasDataError();
    }
  }
  await tx
    .update(customerFieldDefs)
    .set({
      ...(change.name === undefined ? {} : { name: change.name.normalize('NFC') }),
      ...(change.type === undefined ? {} : { type: change.type }),
      ...(change.options === undefined ? {} : { options: [...change.options] }),
      ...(change.required === undefined ? {} : { required: change.required }),
      ...(change.sensitive === undefined ? {} : { sensitive: change.sensitive }),
      ...(change.hidden === undefined ? {} : { hidden: change.hidden }),
      ...(change.position === undefined ? {} : { position: change.position }),
      updatedAt: sql`now()`,
    })
    .where(eq(customerFieldDefs.id, current.id));
  return (await lockField(tx, current.id)) as FieldRow;
}

/** Ends a field locked before (deleted_at); FieldHasDataError when it has data (it can only be hidden). */
export async function deleteField(tx: TenantTx, current: FieldRow): Promise<void> {
  if (current.hasData) throw new FieldHasDataError();
  await tx
    .update(customerFieldDefs)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(customerFieldDefs.id, current.id));
}
