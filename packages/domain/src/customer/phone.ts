// Phone numbers as the CRM stores them (Brief §158 "SĐT chuẩn +84", N165): E.164, a plus and 8 to 15 digits. A number typed the
// Vietnamese way (0 and the subscriber number) is a number of +84; 84… and 00… already name their country.

const SEPARATORS = /[\s.\-()]/g;

/** The digits after the plus, or null: `0912 345 678` and `+84 912 345 678` give `84912345678`. */
function countryDigits(input: string): string | null {
  const raw = input.trim().replace(SEPARATORS, '');
  if (!/^\+?[0-9]+$/.test(raw)) return null;
  if (raw.startsWith('+')) return raw.slice(1);
  if (raw.startsWith('00')) return raw.slice(2);
  if (raw.startsWith('0')) return `84${raw.slice(1)}`;
  return raw.startsWith('84') ? raw : null;
}

/** `0912 345 678`, `84912345678`, `+84 912 345 678` → `+84912345678`; null for what is not a whole phone number. */
export function toE164(input: string): string | null {
  const digits = countryDigits(input);
  return digits !== null && /^[1-9][0-9]{7,14}$/.test(digits) ? `+${digits}` : null;
}

/**
 * The start of a number typed in a search box, in the stored form (`0912` → `+84912`), so a search finds it with `starts_with`; null
 * when the text is not the start of a number or has fewer than 3 digits (too wide a search).
 */
export function phonePrefix(input: string): string | null {
  const digits = countryDigits(input);
  if (digits === null || input.replace(/[^0-9]/g, '').length < 3) return null;
  return /^[1-9][0-9]{0,14}$/.test(digits) ? `+${digits}` : null;
}
