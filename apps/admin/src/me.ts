import type { components } from './api/schema';
import type { Role } from './nav';

/**
 * Who is signed in: `GET /v1/me` (U32, N145), typed from the OpenAPI of the API (`gen:api`). `org` is null for a person of no
 * company, or of several with none chosen; a platform operator who is also a member gets both (N145), the shell picks (`roleOf`).
 */
export type Me = components['schemas']['Me'];
type OrgRole = NonNullable<Me['org']>['role'];

/** All the roles the API sends: one added to the OpenAPI fails the typecheck here, and in `roleOf` until `nav.ts` has it. */
const ORG_ROLES: Record<OrgRole, true> = {
  owner: true,
  admin: true,
  manager: true,
  sales: true,
  support: true,
  marketing: true,
  viewer: true,
};

export type MeResult =
  | { readonly kind: 'ok'; readonly me: Me }
  | { readonly kind: 'signed_out' }
  | { readonly kind: 'two_factor_setup' }
  | { readonly kind: 'error'; readonly status: number; readonly traceId: string | null };

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
      (typeof org === 'object' &&
        typeof org['role'] === 'string' &&
        Object.hasOwn(ORG_ROLES, org['role'])))
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

/** The role the menu is built for: a platform operator works outside any company, even one who is also a member (prototype, N145). */
export function roleOf(me: Me): Role | null {
  if (me.isPlatformOperator) return 'platform_operator';
  return me.org?.role ?? null;
}
