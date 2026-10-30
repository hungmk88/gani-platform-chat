// Calls of the API from the browser: same origin as the admin (N136), so the session cookie goes with them and nothing else does.
import { errorOf, NETWORK_ERROR, readError, type ApiError } from './errors';

export type { components, paths } from './schema';

export type ApiResult<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: ApiError };

export interface ApiRequest {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly body?: unknown;
  /**
   * One key per action of the person, kept when they try the same action again (Brief P9, N134). A POST always carries one:
   * without this, a new key is made for the call, which still covers the automatic retry below.
   */
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
  /** `false`: never the automatic retry below; the person sends again (#23, CEO 31/10). Default `true`. */
  readonly retry?: boolean;
}

export interface ApiDeps {
  readonly fetch: typeof fetch;
  readonly sleep: (ms: number) => Promise<void>;
  readonly newKey: () => string;
}

const browser: ApiDeps = {
  fetch: (...args) => fetch(...args),
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  newKey: () => crypto.randomUUID(),
};

/** Longest wait before the one automatic retry; a longer one is left to the person. */
export const MAX_WAIT_SECONDS = 10;

/**
 * The statuses a `wait` error is tried again for (CEO 31/10): 429 and 502/503/504. Never another 4xx, on purpose: a 409
 * `idempotency_in_progress` means the first request is still being carried out, and asking again does not help it.
 */
const RETRIED: ReadonlySet<number> = new Set([429, 502, 503, 504]);

/**
 * `path` under the admin's origin (`/v1/...`). Answers the body as `T` (from `components['schemas']`), or the error of the P9
 * table. A `wait` error of a status in RETRIED is tried again once, with the same Idempotency-Key, after its Retry-After (1 s
 * when none is given), unless the call says `retry: false`.
 */
export async function api<T>(
  path: string,
  req: ApiRequest = {},
  deps: ApiDeps = browser,
): Promise<ApiResult<T>> {
  const method = req.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (req.body !== undefined) headers['content-type'] = 'application/json';
  if (method === 'POST') headers['idempotency-key'] = req.idempotencyKey ?? deps.newKey();
  const init: RequestInit = {
    method,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
    ...(req.body === undefined ? {} : { body: JSON.stringify(req.body) }),
    ...(req.signal ? { signal: req.signal } : {}),
  };

  for (let attempt = 0; ; attempt++) {
    const res = await deps.fetch(path, init).catch(() => undefined);
    if (!res) return { ok: false, error: NETWORK_ERROR };
    if (res.ok) {
      if (res.status === 204) return { ok: true, data: undefined as T };
      const data: unknown = await res.json().catch(() => NO_BODY);
      return data === NO_BODY
        ? { ok: false, error: errorOf(502, null) }
        : { ok: true, data: data as T };
    }
    const error = await readError(res);
    const wait = error.retryAfter ?? 1;
    const again = req.retry !== false && error.action === 'wait' && RETRIED.has(error.status);
    if (!again || attempt > 0 || wait > MAX_WAIT_SECONDS) return { ok: false, error };
    await deps.sleep(wait * 1000);
  }
}

const NO_BODY = Symbol('no body');
