import { cookies } from 'next/headers';
import { cache } from 'react';

import { readMe, type MeResult } from './me';

/** The API behind the same public origin (N136); in development `next.config.ts` forwards to it, here the server calls it directly. */
const API_ORIGIN = process.env['API_ORIGIN'] ?? 'http://localhost:3000';

/** `GET /v1/me` with the session cookie of the request: once per request (the layout and the page share it), never across requests. */
export const getMe = cache(async (): Promise<MeResult> => {
  const cookie = (await cookies()).toString();
  try {
    const res = await fetch(`${API_ORIGIN}/v1/me`, { headers: { cookie }, cache: 'no-store' });
    return await readMe(res);
  } catch {
    return { kind: 'error', status: 503, traceId: null };
  }
});
