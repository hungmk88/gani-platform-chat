import type { FieldFit, FieldValueRow } from '@gani/db';
import { toE164 } from '@gani/domain';
import { z } from 'zod';

// The values of a customer's custom fields (J1, N191; Tag 3b-iii): what each type takes, and how the API gives them back.

/** What Marketing and Viewer read in place of a sensitive value (P8, CEO 02/11 answer 4). */
export const MASK = '••••';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const Email = z.email();

/** A calendar date `YYYY-MM-DD` that exists (no 31 February). */
function isDate(text: string): boolean {
  const m = DATE.exec(text);
  if (!m) return false;
  const at = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return at.toISOString().slice(0, 10) === text;
}

/**
 * The value a field of `type` stores, or undefined for one it does not take (422 invalid_field_value): text as sent; a finite number;
 * a date that exists; one of the choices, or several, each once; a phone number in E.164 as the customers' (`toE164`); an email in
 * lower case.
 */
export const fitFieldValue: FieldFit = (field, value) => {
  const text = typeof value === 'string' ? value : undefined;
  switch (field.type) {
    case 'text':
      return text;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    case 'date':
      return text !== undefined && isDate(text) ? text : undefined;
    case 'select':
      return text !== undefined && field.options.includes(text) ? text : undefined;
    case 'multiselect':
      return typeof value === 'object' &&
        new Set(value).size === value.length &&
        value.every((v) => field.options.includes(v))
        ? value
        : undefined;
    case 'phone':
      return (text !== undefined && toE164(text)) || undefined;
    case 'email': {
      const email = text?.trim().toLowerCase();
      return email !== undefined && Email.safeParse(email).success ? email : undefined;
    }
    default:
      return undefined;
  }
};

/** A customer's values as the API gives them (schema CustomerFieldValues): a sensitive one not opened is the mask. */
export const valuesView = (rows: readonly FieldValueRow[]) => ({
  data: rows.map((r) => ({ fieldId: r.fieldId, value: r.sealed ? MASK : r.value })),
});
