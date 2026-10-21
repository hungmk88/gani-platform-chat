'use client';

import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import { createContext, useContext, useState, type ReactNode } from 'react';

import { ApiFailure, getter } from './fetch';
import { redirectFor, scopeKey, type Scope } from './keys';

const ScopeContext = createContext<Scope | null>(null);

function newClient() {
  return new QueryClient({
    // A session that ended or a 2FA to set up sends the person away from any screen (P9 unauthorized, N93).
    queryCache: new QueryCache({
      onError: (e) => {
        const to = e instanceof ApiFailure ? redirectFor(e.error) : null;
        if (to) window.location.assign(to);
      },
    }),
    // api() already waits and tries a rate limit again; a write is never tried again on its own (P9 internal_error).
    defaultOptions: { queries: { retry: false, staleTime: 30_000 }, mutations: { retry: false } },
  });
}

/** Server state of the signed-in frame. Mounted with `key={scopeId(scope)}`: another company or workspace starts empty. */
export function QueryProvider({ scope, children }: { scope: Scope; children: ReactNode }) {
  const [client] = useState(newClient);
  return (
    <QueryClientProvider client={client}>
      <ScopeContext.Provider value={scope}>{children}</ScopeContext.Provider>
    </QueryClientProvider>
  );
}

/** `GET path` under the key of the scope: `useApiQuery<Schemas['ConversationPage']>(['conversations'], '/v1/conversations')`. */
export function useApiQuery<T>(parts: readonly unknown[], path: string) {
  const scope = useContext(ScopeContext);
  if (!scope) throw new Error('useApiQuery outside QueryProvider');
  return useQuery<T, ApiFailure>({ queryKey: scopeKey(scope, ...parts), queryFn: getter<T>(path) });
}

/** Pages of a cursor list (`{ data, nextCursor }`, P9): `pathOf(cursor)` is the GET of one page, `parts` its key in the scope. */
export function useApiPages<T extends { readonly nextCursor: string | null }>(
  parts: readonly unknown[],
  pathOf: (cursor: string | null) => string,
) {
  const scope = useContext(ScopeContext);
  if (!scope) throw new Error('useApiPages outside QueryProvider');
  return useInfiniteQuery<T, ApiFailure, { pages: T[] }, readonly unknown[], string | null>({
    queryKey: scopeKey(scope, ...parts),
    queryFn: ({ pageParam, signal }) => getter<T>(pathOf(pageParam))({ signal }),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
  });
}
