import type { CustomerView } from '@gani/db';

/** `+84912345678` → `+8491*****78`: the country and the network stay, the subscriber does not. */
export const maskPhone = (phone: string): string =>
  `${phone.slice(0, 5)}${'*'.repeat(Math.max(phone.length - 7, 1))}${phone.slice(-2)}`;
/** `lan.nguyen@example.com` → `l***@example.com`. */
export const maskEmail = (email: string): string => {
  const at = email.indexOf('@');
  return `${email.slice(0, 1)}***${email.slice(at)}`;
};

/** A customer as the API answers it (CustomerSchema); `masked` for Marketing and Viewer (Phụ lục B "Che"). */
export const customerView = (row: CustomerView, masked: boolean) => ({
  id: row.id,
  displayName: row.displayName,
  phone: row.phoneE164 === null ? null : masked ? maskPhone(row.phoneE164) : row.phoneE164,
  email: row.email === null ? null : masked ? maskEmail(row.email) : row.email,
  humanOnly: row.humanOnly,
  identities: row.identities.map((i) => ({ ...i })),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
