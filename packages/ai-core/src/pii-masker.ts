// PII masking before any text leaves for an AI provider (packages/ai-core/CLAUDE.md "PII masking", Brief P12, N180). Each value
// found becomes a numbered placeholder, `[PHONE_1]`, `[ADDRESS_1]`…, kept in a vault so the answer of the model can be unmasked.
// The same value gets the same placeholder in one vault. Regexes and known names only, no NER (A, 01/11/2026): a person's name is
// masked only when the caller knows it (the customer's name), never guessed. A miss rate of about 5 % is accepted (CLAUDE.md).

export type PiiType =
  | 'EMAIL'
  | 'TAX_ID'
  | 'BANK_ACCOUNT'
  | 'ID_NUMBER'
  | 'DOB'
  | 'PHONE'
  | 'ADDRESS'
  | 'NAME'
  | 'ORDER_ID';

/** The originals of the placeholders of one conversation; never logged, never sent. */
export interface PiiVault {
  readonly byPlaceholder: Map<string, string>;
  readonly byValue: Map<string, string>;
  readonly counts: Map<PiiType, number>;
}

export interface PiiMaskOptions {
  /** Names of people known to the caller (the customer's name), masked wherever they appear, with or without diacritics. */
  readonly knownNames?: readonly string[];
  /** The order number patterns of the tenant; the default is a guess until the format is known (U76). Must have the `g` flag. */
  readonly orderIdPatterns?: readonly RegExp[];
}

export const createPiiVault = (): PiiVault => ({
  byPlaceholder: new Map(),
  byValue: new Map(),
  counts: new Map(),
});

/** No Vietnamese format is known yet (U76): 2–4 capitals, an optional - or _, then 4–10 digits (A, 01/11/2026). */
export const DEFAULT_ORDER_ID = /\b[A-Z]{2,4}[-_]?\d{4,10}\b/g;

const L = '\\p{L}';
const NOT_WORD_BEFORE = `(?<![${L}\\d])`;
const NOT_WORD_AFTER = `(?![${L}\\d])`;
// A run of digits, maybe split by spaces, dots or dashes (as people type numbers).
const digits = (min: number, max: number) => `\\d(?:[ .-]?\\d){${min - 1},${max - 1}}`;
// "MST: 0101234567", "số tài khoản 0123 4567 8901", "CCCD 001099012345", "ngày sinh 12/03/1990": a keyword, then the value.
const keyed = (keywords: string, value: string) =>
  new RegExp(`(?<=${NOT_WORD_BEFORE}(?:${keywords})\\s*(?:là|la|:|#)?\\s*)${value}`, 'giu');

// Address words, with and without diacritics; `[đd]` covers "đường"/"duong". The start of a detailed address: a house number then a
// street word, or a hamlet word (rural addresses have no house number). Later segments, after commas, carry an administrative word.
const STREET = '(?:đường|duong|đ\\.|phố|pho|ngõ|ngo|ngách|ngach|hẻm|hem|kiệt|kiet)';
const HAMLET = '(?:thôn|thon|ấp|ap|xóm|xom|tổ|to|khu phố|khu pho)';
const ADMIN = `(?:phường|phuong|p\\.|xã|xa|thị trấn|thi tran|quận|quan|q\\.|huyện|huyen|thị xã|thi xa|thành phố|thanh pho|tp\\.?|tỉnh|tinh|${STREET}|${HAMLET})`;
const SEGMENT_REST = `[${L}\\d .'/-]{1,40}?`;
const ADDRESS = new RegExp(
  `${NOT_WORD_BEFORE}(?:(?:số\\s*|so\\s*)?\\d+[a-z]?(?:\\/\\d+[a-z]?)*,?\\s+${STREET}\\s+${SEGMENT_REST}|${HAMLET}\\s+${SEGMENT_REST})` +
    `(?:,\\s*${ADMIN}\\s*${SEGMENT_REST})*(?=[,.;\\n]|$)`,
  'giu',
);

const RULES: readonly (readonly [PiiType, RegExp])[] = [
  ['EMAIL', /[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/gu],
  ['TAX_ID', keyed('mst|mã số thuế|ma so thue', `${digits(10, 10)}(?:-\\d{3})?`)],
  ['BANK_ACCOUNT', keyed('stk|số tài khoản|so tai khoan|tài khoản|tai khoan|tk', digits(6, 19))],
  ['ID_NUMBER', keyed('cccd|cmnd|căn cước|can cuoc|hộ chiếu|ho chieu', '[a-z]?\\d{8,12}')],
  ['DOB', keyed('ngày sinh|ngay sinh|sinh ngày|sinh ngay|dob', '\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{4}')],
  // Vietnamese mobiles and landlines: +84 or 0, then 9 or 10 digits.
  [
    'PHONE',
    new RegExp(`${NOT_WORD_BEFORE}(?:\\+84|84|0)(?:[ .-]?\\d){9,10}${NOT_WORD_AFTER}`, 'gu'),
  ],
  // A CCCD without its keyword: 12 digits on their own.
  ['ID_NUMBER', new RegExp(`${NOT_WORD_BEFORE}\\d{12}${NOT_WORD_AFTER}`, 'gu')],
  ['ADDRESS', ADDRESS],
];

const VARIANTS: Record<string, string> = {
  a: 'aàáảãạăằắẳẵặâầấẩẫậ',
  e: 'eèéẻẽẹêềếểễệ',
  i: 'iìíỉĩị',
  o: 'oòóỏõọôồốổỗộơờớởỡợ',
  u: 'uùúủũụưừứửữự',
  y: 'yỳýỷỹỵ',
  d: 'dđ',
};
const BASE = new Map(Object.entries(VARIANTS).flatMap(([b, all]) => [...all].map((c) => [c, b])));

/** A pattern for a known name: any case, any diacritics, any spaces between its words. */
function namePattern(name: string): RegExp | null {
  const words = name.normalize('NFC').toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const word = (w: string) =>
    [...w]
      .map((c) => {
        const base = BASE.get(c);
        return base ? `[${VARIANTS[base]}]` : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('');
  return new RegExp(`${NOT_WORD_BEFORE}${words.map(word).join('\\s+')}${NOT_WORD_AFTER}`, 'giu');
}

function placeholderFor(vault: PiiVault, type: PiiType, value: string): string {
  const key = `${type}\u0000${value}`;
  const known = vault.byValue.get(key);
  if (known) return known;
  const n = (vault.counts.get(type) ?? 0) + 1;
  vault.counts.set(type, n);
  const placeholder = `[${type}_${n}]`;
  vault.byValue.set(key, placeholder);
  vault.byPlaceholder.set(placeholder, value);
  return placeholder;
}

/** `text` with its PII replaced by placeholders, recorded in `vault` (pass the conversation's vault to keep the numbering). */
export function maskPii(text: string, vault: PiiVault, options: PiiMaskOptions = {}): string {
  const names = (options.knownNames ?? [])
    .map(namePattern)
    .filter((p): p is RegExp => p !== null)
    .map((p) => ['NAME', p] as const);
  const orders = (options.orderIdPatterns ?? [DEFAULT_ORDER_ID]).map(
    (p) => ['ORDER_ID', p] as const,
  );
  // Longer names first: "Nguyễn Văn An" before "An".
  names.sort((x, y) => y[1].source.length - x[1].source.length);
  let out = text.normalize('NFC');
  for (const [type, pattern] of [...RULES, ...names, ...orders])
    out = out.replace(pattern, (value) => placeholderFor(vault, type, value.trim()));
  return out;
}

/** The answer of the model with the placeholders of `vault` put back; a placeholder the vault does not hold stays as it is. */
export function unmaskPii(text: string, vault: PiiVault): string {
  return text.replace(/\[[A-Z_]+_\d+\]/g, (p) => vault.byPlaceholder.get(p) ?? p);
}
