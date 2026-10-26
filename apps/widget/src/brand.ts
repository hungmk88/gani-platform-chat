// The brand of a workspace on the widget (apps/widget/CLAUDE.md "Thương hiệu"): name, colour, greeting. Until the widget API
// (`/v1/widget/*`, S10) gives the configuration of a widget key, it comes from the data-* attributes of the embed script.

export interface Brand {
  readonly name: string;
  readonly color: string;
  readonly greeting: string;
  /** The company's data policy (`data-policy-url`, https only), linked from the pre-chat form; null when the page gives none. */
  readonly policyUrl: string | null;
}

/** The colour behind the white text when the brand's own does not reach 4.5:1 with white. */
export const NEUTRAL = '#1f2937';
const WHITE = '#ffffff';
const HEX = /^#[0-9a-f]{6}$/i;

const DEFAULT_NAME = 'Hỗ trợ khách hàng';
const DEFAULT_GREETING = 'Chào bạn, mình có thể giúp gì?';

/** Relative luminance of a #rrggbb colour (WCAG 2.1). */
export function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The contrast ratio of two #rrggbb colours, 1 to 21 (WCAG 2.1). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The brand's colour when it is a #rrggbb that carries white text at ≥ 4.5:1, else the neutral one. */
export function brandColor(color: string | undefined): string {
  const c = color?.trim().toLowerCase() ?? '';
  return HEX.test(c) && contrast(c, WHITE) >= 4.5 ? c : NEUTRAL;
}

const text = (value: string | undefined, max: number, fallback: string): string =>
  value?.trim().slice(0, max) || fallback;

/** An https address, or null: a link the widget opens must not be `javascript:` or plain http. */
export function httpsUrl(value: string | undefined): string | null {
  try {
    const url = new URL(value?.trim() ?? '');
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** The brand from the data-* attributes of the embed script (`data-brand-name`, `-brand-color`, `-greeting`, `-policy-url`). */
export function brandOf(data: Readonly<Record<string, string | undefined>>): Brand {
  return {
    name: text(data.brandName, 60, DEFAULT_NAME),
    color: brandColor(data.brandColor),
    greeting: text(data.greeting, 200, DEFAULT_GREETING),
    policyUrl: httpsUrl(data.policyUrl),
  };
}
