import { cookies } from 'next/headers';
import { cache } from 'react';

import { readSecurityStatus, type SecurityStatus } from './auth';
import { readMe, type MeResult } from './me';

/** The API behind the same public origin (N136); in development `next.config.ts` forwards to it, here the server calls it directly. */
const API_ORIGIN = process.env['API_ORIGIN'] ?? 'http://localhost:3000';

/** A GET of the API with the session cookie of the request; never cached, it is about one person. Undefined: the API is unreachable. */
async function apiGet(path: string): Promise<Response | undefined> {
  const cookie = (await cookies()).toString();
  return fetch(`${API_ORIGIN}${path}`, { headers: { cookie }, cache: 'no-store' }).catch(
    () => undefined,
  );
}

/** `GET /v1/me/security-status`, asked first: it answers a person who still has to set up 2FA, which no other route does (N93). */
export const getSecurityStatus = cache(async (): Promise<SecurityStatus> => {
  const res = await apiGet('/v1/me/security-status');
  return res ? readSecurityStatus(res) : { kind: 'error', status: 503, traceId: null };
});

/** `GET /v1/me` with the session cookie of the request: once per request (the layout and the page share it), never across requests. */
export const getMe = cache(async (): Promise<MeResult> => {
  const res = await apiGet('/v1/me');
  return res ? readMe(res) : { kind: 'error', status: 503, traceId: null };
});
