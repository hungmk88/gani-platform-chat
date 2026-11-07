// #8 Hồ sơ khách, trường tùy chỉnh (J1, N191; CEO brief 169 P2b-1, P2b-2): a customer's values of the company's fields, in words, and the
// change to send. Every role reads them (`GET /v1/customers/{id}/fields`; a sensitive value is "••••" for Marketing and Viewer, masked
// by the API); the roles of "Sửa hồ sơ khách" change them (`PUT`, only the fields sent, null clears one). Checked as the API checks
// (`fitFieldValue` of apps/api customer-field-values.ts) before it is sent.
import type { ApiError } from '../api/errors';
import type { components } from '../api/schema';
import type { CustomerField } from '../customer-data/catalog';
import { toE164 } from './customer-edit';
import { phoneText } from './customers';

export type FieldValue = components['schemas']['CustomerFieldValue'];
export type FieldValues = components['schemas']['CustomerFieldValues'];
type Change = components['schemas']['CustomerFieldValuesChange'];

export const MASK = '••••'; // what Marketing and Viewer read in place of a sensitive value (P8)
export const MAX_TEXT = 1000;

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

/** What the form holds per field: a list of choices for a multiselect, text for any other. */
export type Draft = Readonly<Record<string, string | readonly string[]>>;

export const draftOf = (fields: readonly CustomerField[], values: FieldValues['data']): Draft =>
  Object.fromEntries(
    fields.map((f) => {
      const v = values.find((x) => x.fieldId === f.id)?.value ?? null;
      return [
        f.id,
        f.type === 'multiselect' ? (Array.isArray(v) ? v : []) : v === null ? '' : String(v),
      ];
    }),
  );

/** The value a field sends for what was typed (blank: null, clears it), or why it cannot. */
export function valueOf(
  f: Pick<CustomerField, 'name' | 'type' | 'options'>,
  raw: string | readonly string[],
): { ok: true; value: FieldValue } | { ok: false; problem: string } {
  if (typeof raw !== 'string') return { ok: true, value: raw.length ? [...raw] : null };
  const text = raw.trim();
  if (!text) return { ok: true, value: null };
  const bad = (what: string) => ({ ok: false as const, problem: `${f.name}: ${what}` });
  switch (f.type) {
    case 'number': {
      const n = Number(text.replace(/\s/g, '').replace(',', '.'));
      return Number.isFinite(n) ? { ok: true, value: n } : bad('phải là số (ví dụ 1500 hoặc 2,5).');
    }
    case 'phone': {
      const phone = toE164(text);
      return phone ? { ok: true, value: phone } : bad('SĐT chưa đúng (ví dụ 0912 345 678).');
    }
    case 'email': {
      const email = text.toLowerCase();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        ? { ok: true, value: email }
        : bad('email chưa đúng dạng.');
    }
    case 'select':
      return f.options.includes(text)
        ? { ok: true, value: text }
        : bad('chọn một lựa chọn có sẵn.');
    default:
      return text.length > MAX_TEXT ? bad(`dài quá ${MAX_TEXT} ký tự.`) : { ok: true, value: text };
  }
}

const same = (a: string | readonly string[], b: string | readonly string[]) =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((x) => b.includes(x))
    : a === b;

/** The body of the PUT: only the fields whose box changed; null when none did; the first problem otherwise. */
export function changesOf(
  fields: readonly CustomerField[],
  before: Draft,
  after: Draft,
): Change | null | string {
  const values: Change['values'] = [];
  for (const f of fields) {
    const now = after[f.id] ?? '';
    if (same(before[f.id] ?? '', now)) continue;
    const checked = valueOf(f, now);
    if (!checked.ok) return checked.problem;
    values.push({ fieldId: f.id, value: checked.value });
  }
  return values.length ? { values } : null;
}

/** What a refused change says; `again`: the fields and the values are read again (a field gone, or changed meanwhile). */
export function fieldsFailureOf(e: Pick<ApiError, 'code' | 'message'>): {
  readonly text: string;
  readonly again: boolean;
} {
  if (e.code === 'invalid_field_value')
    return {
      text: 'Có giá trị sai kiểu hoặc không thuộc lựa chọn của trường. Kiểm tra lại.',
      again: true,
    };
  if (e.code === 'not_found')
    return {
      text: 'Có trường vừa bị xóa, hoặc khách không còn. Đã tải lại thông tin thêm.',
      again: true,
    };
  return { text: e.message, again: false };
}
