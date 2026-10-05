import { readMemberContext } from '@gani/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';

import { AuthService } from './modules/auth/auth.service.js';
import { DatabaseService } from './modules/database/database.service.js';
import { SessionResolver } from './modules/request-context/session-resolver.js';
import { createTenantContextMiddleware } from './modules/request-context/tenant-context.middleware.js';

type Mountable = {
  all(path: string, handler: ReturnType<typeof toNodeHandler>): unknown;
  use(path: string, handler: ReturnType<typeof createTenantContextMiddleware>): unknown;
};

/**
 * Puts the layers of the application in order (N90, N92): Better Auth at /api/auth/* BEFORE Nest starts its router (mounted later it
 * gets Nest's 404, measured), then Nest's JSON parser for the rest, then the tenant middleware on /v1, after the parser so the
 * request context is not lost while the body is read. The application is made with `bodyParser: false` so this order is ours.
 * Everything comes from the application's own providers, so a test replaces a provider instead of passing something here.
 * Used by main.ts and every test.
 */
export function setupApp(app: NestExpressApplication): void {
  const express = app.getHttpAdapter().getInstance() as Mountable;
  const authService = app.get(AuthService);
  const database = app.get(DatabaseService);
  express.all('/api/auth/{*any}', toNodeHandler(authService.auth));
  app.useBodyParser('json');
  express.use(
    '/v1',
    createTenantContextMiddleware({
      sessions: app.get(SessionResolver),
      organisations: (userId) => authService.activeOrganisationIds(userId),
      member: (orgId, userId) =>
        database.withTenant({ orgId, workspaceIds: [] }, (tx) => readMemberContext(tx, userId)),
    }),
  );
}
