import { hashPassword, isStrongPassword } from '../modules/auth/password.js';

// The first platform operator of an environment (N25, review DB-02, N148): run ONCE by the deploy pipeline, as migration_role (users and
// accounts have no INSERT for the application). It makes an `active` person with a password and nothing else: no organisation, and no
// second factor yet, so the 2FA gate makes them set one up at the first sign-in (N89). It refuses when an operator already exists, so
// running it again changes nothing. Nothing it prints names the person (no email, never the password): the trace is the pipeline's
// log, with the id and the reason "initial bootstrap" (no audit table has a row without an organisation).

const APP_ENVS = new Set(['development', 'test', 'staging', 'production']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// A constant key: two runs at once queue on it, and the second one sees the first operator.
const LOCK = 7_301_001;

export type BootstrapRefusal =
  'app_env_missing' | 'email_invalid' | 'password_weak' | 'operator_exists' | 'email_taken';

export class BootstrapRefusedError extends Error {
  constructor(readonly reason: BootstrapRefusal) {
    super(`bootstrap refused: ${reason}`);
    this.name = 'BootstrapRefusedError';
  }
}

/** The part of a pg client this needs: one connection in a transaction the caller holds. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rowCount: number | null }>;
}

export interface BootstrapInput {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
}

/** BOOTSTRAP_OPERATOR_EMAIL, BOOTSTRAP_OPERATOR_PASSWORD (ADR-003 rules), BOOTSTRAP_OPERATOR_NAME (optional), and a declared APP_ENV. */
export function readBootstrapEnv(env: Record<string, string | undefined>): BootstrapInput {
  if (!APP_ENVS.has(env['APP_ENV'] ?? '')) throw new BootstrapRefusedError('app_env_missing');
  const email = (env['BOOTSTRAP_OPERATOR_EMAIL'] ?? '').trim().toLowerCase();
  if (!EMAIL.test(email)) throw new BootstrapRefusedError('email_invalid');
  const password = env['BOOTSTRAP_OPERATOR_PASSWORD'] ?? '';
  if (!isStrongPassword(password)) throw new BootstrapRefusedError('password_weak');
  const displayName = (env['BOOTSTRAP_OPERATOR_NAME'] ?? '').trim() || 'Platform operator';
  return { email, password, displayName };
}

/**
 * Makes the operator in the caller's transaction (the caller BEGINs and COMMITs, so a refusal leaves nothing). `ids` are UUIDv7 made
 * by the caller (rule 2). Returns the id of the person made.
 */
export async function bootstrapPlatformOperator(
  client: Queryable,
  input: BootstrapInput,
  ids: { readonly userId: string; readonly accountId: string },
): Promise<string> {
  await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
  const existing = await client.query(
    'SELECT 1 FROM public.users WHERE is_platform_operator AND deleted_at IS NULL LIMIT 1',
  );
  if (existing.rowCount) throw new BootstrapRefusedError('operator_exists');
  const taken = await client.query('SELECT 1 FROM public.users WHERE email = $1', [input.email]);
  if (taken.rowCount) throw new BootstrapRefusedError('email_taken');
  const hash = await hashPassword(input.password);
  await client.query(
    `INSERT INTO public.users (id, email, display_name, status, email_verified_at, is_platform_operator)
     VALUES ($1, $2, $3, 'active', now(), true)`,
    [ids.userId, input.email, input.displayName],
  );
  await client.query(
    `INSERT INTO public.accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`,
    [ids.accountId, ids.userId, ids.userId, hash],
  );
  return ids.userId;
}
