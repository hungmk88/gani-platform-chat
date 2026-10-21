import { SecretBox } from '@gani/channels';
import { insertIfAbsent, readMemberContext } from '@gani/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';

import { AuthService } from './modules/auth/auth.service.js';
import { DatabaseService } from './modules/database/database.service.js';
import { createZaloWebhook } from './modules/hooks/zalo-webhook.js';
import { RealtimeService } from './modules/realtime/realtime.service.js';
import { revalidatePeriodMs } from './modules/realtime/revalidate.js';
import { ProblemFilter, parserErrors } from './modules/request-context/problem.filter.js';
import { createSameOriginCheck } from './modules/request-context/same-origin.js';
import { securityHeaders } from './modules/request-context/security-headers.js';
import { SessionResolver } from './modules/request-context/session-resolver.js';
import { createTenantContextMiddleware } from './modules/request-context/tenant-context.middleware.js';
import { createTwoFactorGate } from './modules/request-context/two-factor.gate.js';

type Mountable = {
  disable(setting: string): unknown;
  all(path: string, handler: ReturnType<typeof toNodeHandler>): unknown;
  use(handler: typeof securityHeaders | typeof parserErrors): unknown;
  use(handler: ReturnType<typeof createTwoFactorGate>): unknown;
  use(path: string, handler: ReturnType<typeof createTenantContextMiddleware>): unknown;
  use(path: string, handler: ReturnType<typeof createSameOriginCheck>): unknown;
  post(path: string, handler: ReturnType<typeof createZaloWebhook>): unknown;
};

/**
 * Puts the layers of the application in order (N90, N92, N93, N136): the same-origin check of /v1 and the 2FA gate first of all, then Better Auth at /api/auth/* BEFORE Nest starts its router (mounted later it
 * gets Nest's 404, measured), then Nest's JSON parser for the rest, then the tenant middleware on /v1, after the parser so the
 * request context is not lost while the body is read. The application is made with `bodyParser: false` so this order is ours.
 * Everything comes from the application's own providers, so a test replaces a provider instead of passing something here.
 * Used by main.ts and every test.
 */
export function setupApp(app: NestExpressApplication): void {
  const express = app.getHttpAdapter().getInstance() as Mountable;
  const authService = app.get(AuthService);
  const database = app.get(DatabaseService);
  // Before anything answers (AR-04): the gate's 403, Better Auth and Nest all send the security headers, and no X-Powered-By.
  express.disable('x-powered-by');
  express.use(securityHeaders);
  // The webhooks of the channels before any parser (the signature is over the raw bytes) and outside the session layers: the tenant
  // comes from the channel account (zalo spec §3). It answers by itself; nothing after it runs for that path.
  express.post(
    '/v1/hooks/zalo/:channelAccountId',
    createZaloWebhook({
      account: (id) => database.channelAccountForWebhook(id),
      secrets: app.get(SecretBox),
      withTenant: (ctx, fn) => database.withTenant(ctx, fn),
      insert: insertIfAbsent,
    }),
  );
  // A change under /v1 that carries the session cookie comes from the application's own origin, or is refused (CSRF, N136).
  express.use('/v1', createSameOriginCheck(authService.origin));
  // First of all, for /api/auth and /v1 alike (N93): nothing of Better Auth or of ours runs for a person who has to set up a second factor.
  express.use(
    createTwoFactorGate({
      sessions: app.get(SessionResolver),
      mustSetUp: (userId) => authService.mustSetUpTwoFactor(userId),
    }),
  );
  express.all('/api/auth/{*any}', toNodeHandler(authService.auth));
  app.useBodyParser('json');
  // A body the parser refuses (malformed, too large) is answered as problem+json, and so is every error Nest catches (AR-03).
  express.use(parserErrors);
  app.useGlobalFilters(new ProblemFilter());
  const organisations = {
    organisations: (userId: string) => authService.activeOrganisationIds(userId),
    member: (orgId: string, userId: string) =>
      database.withTenant({ orgId, workspaceIds: [] }, (tx) => readMemberContext(tx, userId)),
  };
  express.use(
    '/v1',
    createTenantContextMiddleware({ sessions: app.get(SessionResolver), ...organisations }),
  );
  // Socket.IO answers /socket.io/ itself, below Express: none of the layers above run for it, so its handshake does their checks
  // again with the same functions (realtime spec §2, N94).
  app.get(RealtimeService).attach(app.getHttpServer(), {
    origin: authService.origin,
    sessions: app.get(SessionResolver),
    mustSetUp: (userId) => authService.mustSetUpTwoFactor(userId),
    ...organisations,
    freshSessions: app.get(SessionResolver),
    withTenant: (ctx, fn) => database.withTenant(ctx, fn),
    revalidateMs: revalidatePeriodMs(process.env),
  });
}
