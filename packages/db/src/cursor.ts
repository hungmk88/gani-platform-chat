// Opaque cursors for keyset pagination (Brief P9: `?cursor=<opaque>&limit=50`, never an offset). A cursor is base64url of a small
// JSON object with a version, so its shape can change later without old cursors being read wrongly: an unknown version is refused.
// It is not signed: it only says where a list resumes, and the query that reads it still runs under the caller's RLS.

const VERSION = 1;
const SHAPE = /^[A-Za-z0-9_-]{1,512}$/;

/** The cursor is not one this API gave (bad encoding, other version, wrong fields). The message never echoes it. */
export class InvalidCursorError extends Error {
  constructor() {
    super('the cursor is not one this API gave');
    this.name = 'InvalidCursorError';
  }
}

export function encodeCursor(fields: Readonly<Record<string, string | number>>): string {
  return Buffer.from(JSON.stringify({ ...fields, v: VERSION }), 'utf8').toString('base64url');
}

/** The fields of a cursor made by `encodeCursor`; the caller checks each one it needs (`cursorString`, `cursorWhole`). */
export function decodeCursor(raw: string): Readonly<Record<string, unknown>> {
  if (!SHAPE.test(raw)) throw new InvalidCursorError();
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError();
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new InvalidCursorError();
  if ((value as { v?: unknown }).v !== VERSION) throw new InvalidCursorError();
  return value as Record<string, unknown>;
}

export function cursorString(
  fields: Readonly<Record<string, unknown>>,
  name: string,
  pattern: RegExp,
): string {
  const value = fields[name];
  if (typeof value !== 'string' || !pattern.test(value)) throw new InvalidCursorError();
  return value;
}

export function cursorWhole(fields: Readonly<Record<string, unknown>>, name: string): number {
  const value = fields[name];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new InvalidCursorError();
  return value;
}
