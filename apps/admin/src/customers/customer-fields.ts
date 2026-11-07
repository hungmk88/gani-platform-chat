// #8 Hồ sơ khách, trường tùy chỉnh (J1, N191; CEO brief 169 P2b-1): a customer's values of the company's fields, in words. Every
// role reads them (`GET /v1/customers/{id}/fields`; a sensitive value is "••••" for Marketing and Viewer, masked by the API).
// Changing them (`PUT`) is P2b-2.
import type { components } from '../api/schema';
import type { CustomerField } from '../customer-data/catalog';
import { phoneText } from './customers';

export type FieldValue = components['schemas']['CustomerFieldValue'];
export type FieldValues = components['schemas']['CustomerFieldValues'];

export const MASK = '••••'; // what Marketing and Viewer read in place of a sensitive value (P8)

export const fieldsPath = (id: string): string => `/v1/customers/${encodeURIComponent(id)}/fields`;

const NUMBER = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 6 });

/** One value in words: none, masked, a number, a day (dd/mm/yyyy), choices, a phone, or as given. */
export function valueText(
  field: Pick<CustomerField, 'type'>,
  value: FieldValue | undefined,
): string {
  if (value === null || value === undefined || (Array.isArray(value) && !value.length))
    return 'Chưa có';
  if (value === MASK) return MASK;
  if (typeof value === 'number') return NUMBER.format(value);
  if (Array.isArray(value)) return value.join(', ');
  if (field.type === 'date') return value.split('-').reverse().join('/');
  if (field.type === 'phone') return phoneText(value);
  return value;
}

/** The fields to show, by position: every field in use, and a hidden one only when the customer has a value in it. */
export function fieldRows(
  fields: readonly CustomerField[],
  values: FieldValues['data'],
): { readonly field: CustomerField; readonly value: FieldValue }[] {
  const of = new Map(values.map((v) => [v.fieldId, v.value]));
  return [...fields]
    .sort((a, b) => a.position - b.position)
    .map((field) => ({ field, value: of.get(field.id) ?? null }))
    .filter(({ field, value }) => !field.hidden || value !== null);
}
