import { createDbPool, pingDb } from '@gani/db';
import { createSmtpSender, emailPolicy, type EmailSender } from '@gani/email';
import { Logger, type OnApplicationShutdown } from '@nestjs/common';

import { errorCode } from '../database/database.service.js';
import { createAuth } from './auth.config.js';
import { loadAuthEnv, type AuthEnv } from './auth.env.js';
import { mustSetUpTwoFactor, twoFactorStatus, type TwoFactorStatus } from './two-factor.js';

type DbPool = ReturnType<typeof createDbPool>;
export type AuthInstance = ReturnType<typeof createAuth>;

/**
 * Owns Better Auth and the pool of `auth_role` it uses. Unlike DatabaseService it does not start without its settings: a wrong
 * secret, address or missing DATABASE_URL_AUTH stops the process at start-up with a message that says what to fix (N90).
 */
export class AuthService implements OnApplicationShutdown {
  private readonly logger = new Logger(AuthService.name);
  private readonly pool: DbPool;
  private closed = false;
  readonly auth: AuthInstance;
  /** BETTER_AUTH_URL: the one origin a change under /v1 may come from (N136). */
  readonly origin: string;

  /** `sender` carries the links of "Quên mật khẩu" (N162); without it those routes do not exist (unit tests). */
  constructor(
    env: AuthEnv,
    url: string,
    create: typeof createDbPool = createDbPool,
    private readonly sender?: EmailSender,
  ) {
    this.origin = env.baseURL;
    this.pool = create(url, {
      onError: (error) => this.logger.warn(`auth pool error (${errorCode(error)})`),
    });
    this.auth = createAuth({ pool: this.pool, env, ...(sender ? { sender } : {}) });
  }

  static fromEnv(env: Record<string, string | undefined>): AuthService {
    const authEnv = loadAuthEnv(env);
    const url = env['DATABASE_URL_AUTH'];
    if (!url)
      throw new Error('DATABASE_URL_AUTH is not set: Better Auth signs in through auth_role');
    // Checked at start-up like the mailer of invitations (N149): production without SMTP_URL, EMAIL_FROM or encryption stops here.
    const logger = new Logger(AuthService.name);
    const sender = createSmtpSender(emailPolicy(env, (line) => logger.warn(line)));
    return new AuthService(authEnv, url, createDbPool, sender);
  }

  /** Can the auth pool reach its database? Same shape as DatabaseService.ping(): never throws, never says why. */
  ping(): Promise<boolean> {
    return pingDb(this.pool);
  }

  /**
   * Ids of the organisations in which `userId` is an ACTIVE member (a left, suspended or deleted membership is not listed), for the
   * tenant middleware when the session has no usable organisation yet. Goes through `app.memberships_for_user` because without a
   * tenant context `app_role` can read nothing. `userId` must be the person of an authenticated session, never a request value (N76).
   */
  async activeOrganisationIds(userId: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ org_id: string }>(
      `SELECT org_id FROM app.memberships_for_user($1) WHERE status = 'active' ORDER BY org_id`,
      [userId],
    );
    return rows.map((row) => row.org_id);
  }

  /** Must this person set up a second factor and has not (N89)? Asked by the gate at the edge on every request that has a session. */
  mustSetUpTwoFactor(userId: string): Promise<boolean> {
    return mustSetUpTwoFactor(this.pool, userId);
  }

  /**
   * Name and platform right of `userId` for `GET /v1/me` (U32), or `null` for a person who was deleted. `users` is global and
   * `app_role` cannot read it, so this goes through the column grants of `auth_role`. The name falls back to the email (N145).
   */
  async profile(userId: string): Promise<{ name: string; isPlatformOperator: boolean } | null> {
    const { rows } = await this.pool.query<{ name: string; is_platform_operator: boolean }>(
      `SELECT coalesce(nullif(btrim(display_name), ''), email) AS name, is_platform_operator
         FROM public.users WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    const [row] = rows;
    return row ? { name: row.name, isPlatformOperator: row.is_platform_operator } : null;
  }

  /**
   * Sets the name `userId` goes by (`PATCH /v1/me`, N162); false for a person who was deleted. Only the person of an authenticated
   * session renames themselves: `userId` is never a request value. `auth_role` may change display_name and nothing else of a person.
   */
  async rename(userId: string, name: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE public.users SET display_name = $2, updated_at = now() WHERE id = $1 AND deleted_at IS NULL`,
      [userId, name],
    );
    return rowCount === 1;
  }

  twoFactorStatus(userId: string): Promise<TwoFactorStatus | null> {
    return twoFactorStatus(this.pool, userId);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.all([this.pool.end(), this.sender?.close()]);
  }
}
