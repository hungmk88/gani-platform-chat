// WCAG 2.1 contrast of the colours in tokens.css, so a change of a token that breaks AA fails a test, not an audit.

/** The custom properties of a stylesheet, `--name: value;` → { name: value }. Comments are removed first. */
export function readTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g))
    tokens.set(m[1] ?? '', (m[2] ?? '').trim());
  return tokens;
}

/** `#rgb` or `#rrggbb` to [r, g, b] in 0–255; anything else is an error (tokens of colour pairs are plain hex). */
export function parseHex(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) throw new Error(`not a hex colour: ${hex}`);
  const full = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio of two hex colours, 1 to 21 (WCAG 2.1 §1.4.3). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(parseHex(a)), luminance(parseHex(b))].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}
