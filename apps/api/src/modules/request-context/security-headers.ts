import type { IncomingMessage, ServerResponse } from 'node:http';

// Review AR-04: the headers every response of the API carries, /api/auth included. The API answers JSON only, so nothing may be framed,
// sniffed, embedded or loaded from it, and no referrer leaves it. Strict-Transport-Security is sent on every response: a browser ignores
// it over http (RFC 6797 §8.1), so a developer machine is not affected. No CORS header is sent on purpose: the admin and the widget are
// served from the same origin (BETTER_AUTH_URL), and a cross-origin client is refused by the browser until a decision says otherwise.
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

/** Express middleware: first of all in setupApp, so the gate's 403/503 and Better Auth's answers carry them too. */
export function securityHeaders(
  _req: IncomingMessage,
  res: ServerResponse,
  next: (error?: unknown) => void,
): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  next();
}
