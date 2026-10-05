import { createDbPool, pingDb } from '@gani/db';
import { Logger, type OnApplicationShutdown } from '@nestjs/common';

import { errorCode } from '../database/database.service.js';
import { createAuth } from './auth.config.js';
import { loadAuthEnv, type AuthEnv } from './auth.env.js';

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

  constructor(env: AuthEnv, url: string, create: typeof createDbPool = createDbPool) {
    this.pool = create(url, {
      onError: (error) => this.logger.warn(`auth pool error (${errorCode(error)})`),
    });
    this.auth = createAuth({ pool: this.pool, env });
  }

  static fromEnv(env: Record<string, string | undefined>): AuthService {
    const authEnv = loadAuthEnv(env);
    const url = env['DATABASE_URL_AUTH'];
    if (!url)
      throw new Error('DATABASE_URL_AUTH is not set: Better Auth signs in through auth_role');
    return new AuthService(authEnv, url);
  }

  /** Can the auth pool reach its database? Same shape as DatabaseService.ping(): never throws, never says why. */
  ping(): Promise<boolean> {
    return pingDb(this.pool);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }
}
