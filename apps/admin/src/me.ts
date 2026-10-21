import type { Role } from './nav';

/**
 * Who is signed in: `GET /v1/me`, asked of Backend in U32 (shape proposed there, not served yet). Until it is, the shell shows the
 * error page; nothing here invents a person or a role.
 */
export interface Me {
  readonly id: string;
  readonly name: string;
  readonly isPlatformOperator: boolean;
  readonly org: {
    readonly id: string;
    readonly name: string;
    readonly role: Exclude<Role, 'platform_operator'>;
  } | null;
  readonly workspaces: readonly { readonly id: string; readonly name: string }[];
}

export type MeResult =
  | { readonly kind: 'ok'; readonly me: Me }
  | { readonly kind: 'signed_out' }
  | { readonly kind: 'two_factor_setup' }
  | { readonly kind: 'error'; readonly status: number; readonly traceId: string | null };

const ORG_ROLES = new Set(['owner', 'admin', 'manager', 'sales', 'support', 'marketing', 'viewer']);

function isMe(v: unknown): v is Me {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Record<string, unknown>;
  const org = m['org'] as Record<string, unknown> | null | undefined;
  return (
    typeof m['id'] === 'string' &&
    typeof m['name'] === 'string' &&
    typeof m['isPlatformOperator'] === 'boolean' &&
    Array.isArray(m['workspaces']) &&
    (org === null ||
      (typeof org === 'object' && typeof org['role'] === 'string' && ORG_ROLES.has(org['role'])))
  );
}

/** The answer of `GET /v1/me` as the shell acts on it (RFC 9457 errors, `code` of the P9 table). */
export async function readMe(res: Response): Promise<MeResult> {
  const body: unknown = await res.json().catch(() => null);
  if (res.ok)
    return isMe(body) ? { kind: 'ok', me: body } : { kind: 'error', status: 502, traceId: null };
  if (res.status === 401) return { kind: 'signed_out' };
  const problem = (body ?? {}) as { code?: unknown; traceId?: unknown };
  if (res.status === 403 && problem.code === 'two_factor_setup_required')
    return { kind: 'two_factor_setup' };
  return {
    kind: 'error',
    status: res.status,
    traceId: typeof problem.traceId === 'string' ? problem.traceId : null,
  };
}

/** The role the menu is built for: a platform operator works outside any company (prototype, U32 asks Backend to confirm). */
export function roleOf(me: Me): Role | null {
  if (me.isPlatformOperator) return 'platform_operator';
  return me.org?.role ?? null;
}
