import { createDbPool, pingDb } from '@gani/db';
import { Logger, type OnApplicationShutdown } from '@nestjs/common';

type DbPool = ReturnType<typeof createDbPool>;

/** Only the SQLSTATE or system code of a driver error: its message can name hosts, roles or parameters. */
function errorCode(error: Error): string {
  return 'code' in error && typeof error.code === 'string' ? error.code : 'unknown';
}

/**
 * Owns the connection pool of `app_role`. Built by a factory provider (see DatabaseModule), not by DI.
 * The pool is lazy: without DATABASE_URL_APP no pool exists and `ping()` is false, so the API still starts
 * (and `/healthz` still answers) on a machine without a database.
 */
export class DatabaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: DbPool | null;
  private closed = false;

  constructor(url: string | undefined, create: typeof createDbPool = createDbPool) {
    this.pool = url
      ? create(url, {
          onError: (error) => this.logger.warn(`database pool error (${errorCode(error)})`),
        })
      : null;
  }

  async ping(): Promise<boolean> {
    return this.pool !== null && (await pingDb(this.pool));
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.pool === null || this.closed) return;
    this.closed = true;
    await this.pool.end();
  }
}
