import type { NestExpressApplication } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';

import type { AuthInstance } from './modules/auth/auth.service.js';

type Mountable = { all(path: string, handler: ReturnType<typeof toNodeHandler>): unknown };

/**
 * Puts Better Auth at /api/auth/* BEFORE Nest starts its router (mounted later it gets Nest's 404, measured), then Nest's JSON parser
 * for the rest (N90). The application is made with `bodyParser: false` so this order is ours. Used by main.ts and every test.
 */
export function setupApp(app: NestExpressApplication, auth: AuthInstance): void {
  const express = app.getHttpAdapter().getInstance() as Mountable;
  express.all('/api/auth/{*any}', toNodeHandler(auth));
  app.useBodyParser('json');
}
