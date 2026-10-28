import type { CustomerSearch } from '@gani/db';
import { phonePrefix } from '@gani/domain';

/**
 * What `q` searches (N165, U48), the same for the Khách hàng list and the Inbox (U30): a whole email when it has an `@` (equal, any
 * case: never a part, so it cannot spell out an address, and never the name instead), the start of a phone number from 3 digits, a
 * part of the name otherwise. A masked role searches by name only: it could otherwise test whether a number or an address is a
 * customer's.
 */
export function searchOf(q: string, masked: boolean): CustomerSearch {
  if (masked) return { name: q };
  if (q.includes('@')) return { email: q.toLowerCase() };
  const prefix = phonePrefix(q);
  return prefix === null ? { name: q } : { phonePrefix: prefix };
}
