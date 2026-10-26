// "Sửa hồ sơ khách" (#8, `PATCH /v1/customers/{id}`, N165): Owner, Admin, Manager, Sales and Support (Phụ lục B) change the name,
// the phone, the email and the "chỉ người phục vụ" flag; null clears a field. Checked as the API checks before it is sent.
import type { ApiError } from '../api/errors';
import type { components } from '../api/schema';
import type { Role } from '../nav';
import { phoneText, type Customer } from './customers';

type Change = components['schemas']['CustomerChange'];

export const MAX_NAME = 200;
export const MAX_EMAIL = 254;
const EDITORS: readonly Role[] = ['owner', 'admin', 'manager', 'sales', 'support'];

/** Who may change a profile (Phụ lục B "Sửa hồ sơ khách"); Marketing and Viewer only read it, masked. */
export const mayEditCustomers = (role: Role): boolean => EDITORS.includes(role);

/**
 * A number as the API stores it (E.164, `toE164` of @gani/domain): `0912 345 678`, `84912345678`, `+84 912 345 678` →
 * `+84912345678`; null for what is not a whole phone number.
 */
export function toE164(input: string): string | null {
  const raw = input.trim().replace(/[\s.\-()]/g, '');
  if (!/^\+?[0-9]+$/.test(raw)) return null;
  const digits = raw.startsWith('+')
    ? raw.slice(1)
    : raw.startsWith('00')
      ? raw.slice(2)
      : raw.startsWith('0')
        ? `84${raw.slice(1)}`
        : raw.startsWith('84')
          ? raw
          : null;
  return digits !== null && /^[1-9][0-9]{7,14}$/.test(digits) ? `+${digits}` : null;
}

export interface Draft {
  readonly name: string;
  readonly phone: string;
  readonly email: string;
  readonly humanOnly: boolean;
}

export const draftOf = (c: Customer): Draft => ({
  name: c.displayName ?? '',
  phone: c.phone ? phoneText(c.phone) : '',
  email: c.email ?? '',
  humanOnly: c.humanOnly,
});

// What a browser takes as an email, close to the API's `z.email()`: one @, a dot in the domain, no spaces.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The body of the PATCH (only the fields that changed; a blank field is null and clears it), or why it cannot be sent. An empty
 * body means nothing changed: the API refuses it (400), so the dialog just closes.
 */
export function changeOf(c: Customer, d: Draft): Change | string {
  const name = d.name.trim() || null;
  if (name && name.length > MAX_NAME) return `Tên tối đa ${MAX_NAME} ký tự.`;
  const typed = d.phone.trim();
  const phone = typed ? toE164(typed) : null;
  if (typed && !phone) return 'SĐT chưa đúng dạng: ví dụ 0912 345 678 hoặc +84 912 345 678.';
  const email = d.email.trim().toLowerCase() || null;
  if (email && (email.length > MAX_EMAIL || !EMAIL.test(email)))
    return 'Email chưa đúng dạng: ví dụ ten@congty.vn.';
  return {
    ...(name !== c.displayName ? { displayName: name } : {}),
    ...(phone !== c.phone ? { phone } : {}),
    ...(email !== c.email ? { email } : {}),
    ...(d.humanOnly !== c.humanOnly ? { humanOnly: d.humanOnly } : {}),
  };
}

/** The refusals of `PATCH /v1/customers/{id}` in words of the screen. */
export function customerEditError(error: ApiError): string {
  if (error.code === 'validation_failed')
    return 'Máy chủ không nhận giá trị này (tên 1–200 ký tự, SĐT là số điện thoại đủ số, email đúng dạng).';
  if (error.code === 'forbidden') return 'Vai trò của bạn không sửa được hồ sơ khách.';
  if (error.code === 'not_found') return 'Không tìm thấy khách này. Có thể hồ sơ đã bị xóa.';
  return error.message;
}
