import { createHash } from 'node:crypto';

/** JSON with the keys of every object sorted, so `{"a":1,"b":2}` and `{"b":2,"a":1}` are the same request. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** What makes two requests with one Idempotency-Key the same: method, path (no query) and body. sha256, hex. */
export function requestHash(method: string, path: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method}\n${path}\n${canonicalJson(body ?? null)}`)
    .digest('hex');
}
