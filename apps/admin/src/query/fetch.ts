import { api, type ApiRequest, type ApiResult } from '../api/client';
import type { ApiError } from '../api/errors';

/** The error a query or a mutation fails with: the ApiError of the P9 table, as an Error so TanStack Query can carry it. */
export class ApiFailure extends Error {
  constructor(readonly error: ApiError) {
    super(error.code);
    this.name = 'ApiFailure';
  }
}

/** The data of an answer, or throw its ApiFailure. */
export async function unwrap<T>(result: Promise<ApiResult<T>>): Promise<T> {
  const r = await result;
  if (!r.ok) throw new ApiFailure(r.error);
  return r.data;
}

/** A queryFn of `GET path`, cancelled with the query. */
export const getter =
  <T>(path: string, call: typeof api = api) =>
  ({ signal }: { signal: AbortSignal }): Promise<T> =>
    unwrap(call<T>(path, { signal } satisfies ApiRequest));
