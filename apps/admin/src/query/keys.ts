// The cache of the admin is per company and per workspace (Brief UI §2.6): every query key starts with both, so data of one
// never answers a screen of the other, and a change of either drops the cache (QueryProvider is keyed by scopeId).
import type { ApiError } from '../api/errors';

export interface Scope {
  readonly orgId: string | null;
  /** The workspace being worked in, chosen in the top bar (`workspace-choice.ts`, T1); null for one who has none. */
  readonly workspaceId: string | null;
}

export const scopeId = (s: Scope) => `${s.orgId ?? '-'}:${s.workspaceId ?? '-'}`;

/** `['org', orgId, 'ws', workspaceId, ...parts]`. */
export const scopeKey = (s: Scope, ...parts: readonly unknown[]): readonly unknown[] => [
  'org',
  s.orgId ?? '-',
  'ws',
  s.workspaceId ?? '-',
  ...parts,
];

/** Where an error of any query sends the person; null when the screen shows it itself. */
export function redirectFor(error: Pick<ApiError, 'action'>): string | null {
  if (error.action === 'sign_in') return '/login';
  if (error.action === 'set_up_2fa') return '/two-factor/setup';
  return null;
}
