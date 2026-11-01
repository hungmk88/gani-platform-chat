// The last check before a request leaves for an AI provider (A, 01/11/2026, N181): PII still in the text after maskPii is a leak.
// It is written as a warning `pii_leak_detected` (code PII_LEAK_DETECTED) with the TYPES found, never a value, and counted through
// `onLeakDetected` (the API or the worker that calls the AI ties it to its Prometheus counter). Its own patterns, not the masker's:
// a hole in the masker must not also be a hole here. It reports; the caller decides whether to send.

export type PiiLeakType = 'PHONE' | 'EMAIL' | 'ID_NUMBER';

/** The worker's Logger fits: plain values only. */
export interface PiiLeakLogger {
  warn(message: string, fields: Readonly<Record<string, string | number>>): void;
}

export interface PiiLeakHooks {
  readonly log: PiiLeakLogger;
  /** Called once per type found, e.g. to add 1 to ai_pii_leak_detected_total{type}. */
  readonly onLeakDetected?: (type: PiiLeakType) => void;
  /** Ids of the request for the warning (traceId, orgId…), never content. */
  readonly ids?: Readonly<Record<string, string>>;
}

const EDGE_BEFORE = '(?<![\\p{L}\\d])';
const EDGE_AFTER = '(?![\\p{L}\\d])';
const LEAKS: readonly (readonly [PiiLeakType, RegExp])[] = [
  ['EMAIL', /[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/u],
  ['PHONE', new RegExp(`${EDGE_BEFORE}(?:\\+?84|0)(?:[ .-]?\\d){8,10}${EDGE_AFTER}`, 'u')],
  // CCCD (12 digits) or old CMND (9 digits), standing alone.
  ['ID_NUMBER', new RegExp(`${EDGE_BEFORE}(?:\\d{12}|\\d{9})${EDGE_AFTER}`, 'u')],
];

/** The PII types still in `text`; a placeholder like [PHONE_1] matches none of the patterns. */
export function findPiiLeaks(text: string): PiiLeakType[] {
  return LEAKS.filter(([, pattern]) => pattern.test(text)).map(([type]) => type);
}

/** Checks `text` before it is sent: warns and counts each type found; returns the types (empty when clean). */
export function checkPiiLeaks(text: string, hooks: PiiLeakHooks): PiiLeakType[] {
  const types = findPiiLeaks(text);
  if (types.length === 0) return types;
  hooks.log.warn('pii_leak_detected', {
    ...hooks.ids,
    code: 'PII_LEAK_DETECTED',
    types: types.join(','),
    count: types.length,
  });
  for (const type of types) hooks.onLeakDetected?.(type);
  return types;
}
