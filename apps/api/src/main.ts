import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module.js';
import { setupApp } from './app-setup.js';
import { AuthService } from './modules/auth/auth.service.js';

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';

function readPort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError(`PORT must be an integer in [1, 65535], got "${raw}"`);
  }
  return port;
}

async function bootstrap(): Promise<void> {
  // bodyParser is off on purpose: setupApp mounts Better Auth first and then the JSON parser.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  setupApp(app, app.get(AuthService).auth);
  app.enableShutdownHooks();
  const port = readPort(process.env['PORT']);
  const host = process.env['HOST'] || DEFAULT_HOST;
  await app.listen(port, host);
  new Logger('bootstrap').log(`API listening on http://${host}:${port}`);
}

bootstrap().catch((error: unknown) => {
  new Logger('bootstrap').error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
