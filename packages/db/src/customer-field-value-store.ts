import { uuidv7 } from '@gani/domain';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { liveField as live } from './customer-field-store.js';
import { customers } from './schema/customers.js';
import { customerFieldDefs, customerFieldValues } from './schema/customer-fields.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// The values of the custom fields of a company's customers (J1, Tag 3b-i-b, N191; CEO 03/11/2026). Row-level security keeps them to
// the transaction's organisation; whether a value fits its field's type and choices is the caller's check. A sensitive field's value
// is never stored in clear: the caller hands a `seal` that encrypts it (SecretBox of the API, bound to the row and column) and an
// `open` that decrypts it; this file only moves ciphertext, so @gani/db never holds a key. Nothing is deleted (spec RLS M01 §7 case
// 11): a value is cleared by setting it to NULL.

/** The column a sensitive value is bound to, with its row id, in the additional data of the encryption (Tag 2b migration). */
export const FIELD_VALUE_COLUMN = 'customer_field_values.value_enc';

/** A field named is not a live field of the company (404). */
export class FieldNotFoundError extends Error {
  constructor() {
    super('a field is not of the company');
    this.name = 'FieldNotFoundError';
  }
}

/** A value as stored: a string, a number or a list of strings (the CHECK of customer_field_values). */
export type FieldValue = string | number | readonly string[];
/** Encrypts the JSON of a value for the row `rowId`; gives the ciphertext and the key version. */
export type FieldSeal = (rowId: string, plaintext: string) => { enc: Buffer; keyVersion: number };
/** Decrypts the ciphertext of the row `rowId` back to the JSON of its value. */
export type FieldOpen = (rowId: string, enc: Buffer, keyVersion: number) => string;

export interface FieldValueRow {
  readonly fieldId: string;
  /** The value; null when `sealed`. */
  readonly value: FieldValue | null;
  /** A sensitive value read without `open`: present, not decrypted (the caller masks it). */
  readonly sealed: boolean;
}

/**
 * The values of the live customer `customerId` on live fields, one per field that has one, by the field's position; sensitive ones
 * decrypted by `open`, or `sealed` without it. Null when there is no such live customer.
 */
export async function readFieldValues(
  tx: TenantTx,
  customerId: string,
  open?: FieldOpen,
): Promise<FieldValueRow[] | null> {
  const customer = assertUuid(customerId, 'customerId');
  const [found] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, customer), isNull(customers.deletedAt)));
  if (!found) return null;
  const rows = await tx
    .select({
      id: customerFieldValues.id,
      fieldId: customerFieldValues.fieldId,
      value: customerFieldValues.value,
      valueEnc: customerFieldValues.valueEnc,
      keyVersion: customerFieldValues.keyVersion,
    })
    .from(customerFieldValues)
    .innerJoin(
      customerFieldDefs,
      and(
        eq(customerFieldDefs.orgId, customerFieldValues.orgId),
        eq(customerFieldDefs.id, customerFieldValues.fieldId),
      ),
    )
    .where(
      and(
        eq(customerFieldValues.customerId, customer),
        live,
        sql`(${customerFieldValues.value} IS NOT NULL OR ${customerFieldValues.valueEnc} IS NOT NULL)`,
      ),
    )
    .orderBy(asc(customerFieldDefs.position), asc(customerFieldDefs.id));
  return rows.map((r) => {
    if (!r.valueEnc) return { fieldId: r.fieldId, value: r.value as FieldValue, sealed: false };
    if (!open) return { fieldId: r.fieldId, value: null, sealed: true };
    return {
      fieldId: r.fieldId,
      value: JSON.parse(open(r.id, r.valueEnc, r.keyVersion!)) as FieldValue,
      sealed: false,
    };
  });
}

/**
 * Sets values of the live customer `customerId`: only the fields named change, `null` clears one. The customer is locked first (two
 * writes of one customer queue), then its value rows; a sensitive field's value is sealed by `seal`, never written in clear. A field
 * that is not a live field of the company is FieldNotFoundError; null when there is no such live customer. Returns the ids of the fields
 * set.
 */
export async function setFieldValues(
  tx: TenantTx,
  customerId: string,
  values: readonly { readonly fieldId: string; readonly value: FieldValue | null }[],
  seal: FieldSeal,
): Promise<string[] | null> {
  const customer = assertUuid(customerId, 'customerId');
  const [found] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, customer), isNull(customers.deletedAt)))
    .for('update');
  if (!found) return null;
  const ids = [...new Set(values.map((v) => assertUuid(v.fieldId, 'fieldId')))];
  if (ids.length === 0) return [];
  const fields = await tx
    .select({ id: customerFieldDefs.id, sensitive: customerFieldDefs.sensitive })
    .from(customerFieldDefs)
    .where(and(inArray(customerFieldDefs.id, ids), live))
    .for('share', { of: customerFieldDefs });
  if (fields.length !== ids.length) throw new FieldNotFoundError();
  const existing = await tx
    .select({ id: customerFieldValues.id, fieldId: customerFieldValues.fieldId })
    .from(customerFieldValues)
    .where(
      and(eq(customerFieldValues.customerId, customer), inArray(customerFieldValues.fieldId, ids)),
    )
    .for('update');
  const { orgId } = currentTenantContext();
  for (const { fieldId, value } of values) {
    const sensitive = fields.find((f) => f.id === fieldId)!.sensitive;
    const rowId = existing.find((e) => e.fieldId === fieldId)?.id ?? uuidv7();
    const sealed = value !== null && sensitive ? seal(rowId, JSON.stringify(value)) : null;
    const next = {
      value: sealed || value === null ? null : (value as unknown),
      valueEnc: sealed?.enc ?? null,
      keyVersion: sealed?.keyVersion ?? null,
    };
    if (existing.some((e) => e.id === rowId))
      await tx
        .update(customerFieldValues)
        .set({ ...next, updatedAt: sql`now()` })
        .where(eq(customerFieldValues.id, rowId));
    else if (value !== null)
      await tx
        .insert(customerFieldValues)
        .values({ id: rowId, orgId, customerId: customer, fieldId, ...next });
  }
  return values.map((v) => v.fieldId);
}
