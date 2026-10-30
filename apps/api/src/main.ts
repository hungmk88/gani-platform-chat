import 'reflect-metadata';

import { describeError, installCrashHandlers } from '@gani/domain';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module.js';
import { setupApp } from './app-setup.js';
import { RedactingLogger } from './redacting-logger.js';

// No PII in a log (CLAUDE.md rule 5): a crash prints `describeError`, never the error object, and every Logger writes through
// RedactingLogger, the static methods and Better Auth's included.
installCrashHandlers();
const logger = new RedactingLogger();
Logger.overrideLogger(logger);

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
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger,
  });
  setupApp(app);
  app.enableShutdownHooks();
  const port = readPort(process.env['PORT']);
  const host = process.env['HOST'] || DEFAULT_HOST;
  await app.listen(port, host);
  new Logger('bootstrap').log(`API listening on http://${host}:${port}`);
}

bootstrap().catch((error: unknown) => {
  new Logger('bootstrap').error(describeError(error));
  process.exit(1);
});
