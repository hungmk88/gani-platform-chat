import {
  channelAccountForWebhook,
  createDbPool,
  pingDb,
  withTenant,
  type TenantContext,
  type TenantTx,
  type WebhookChannelAccount,
} from '@gani/db';
import { Logger, type OnApplicationShutdown } from '@nestjs/common';

type DbPool = ReturnType<typeof createDbPool>;

/** Only the SQLSTATE or system code of a driver error: its message can name hosts, roles or parameters. */
export function errorCode(error: Error): string {
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

  /** One transaction that acts for `ctx` on the pool of `app_role`: the only way the application reads tenant data (ADR-004). */
  withTenant<T>(ctx: TenantContext, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    if (this.pool === null) {
      return Promise.reject(
        new Error('DATABASE_URL_APP is not set: no tenant transaction is possible'),
      );
    }
    return withTenant(this.pool, ctx, fn);
  }

  /** The channel account a webhook names, before any tenant is known (app.channel_account_for_webhook, N105). */
  channelAccountForWebhook(channelAccountId: string): Promise<WebhookChannelAccount | null> {
    if (this.pool === null) {
      return Promise.reject(
        new Error('DATABASE_URL_APP is not set: no channel account can be read'),
      );
    }
    return channelAccountForWebhook(this.pool, channelAccountId);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.pool === null || this.closed) return;
    this.closed = true;
    await this.pool.end();
  }
}
