import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { RedactingLogger } from './redacting-logger.js';

// What reaches stdout and stderr once main.ts has installed RedactingLogger (CLAUDE.md rule 5): every level, through an instance and
// through the static methods of Logger (no code of the API calls those today; the next one must not get past it).
const EMAIL = 'an.nguyen@example.test';
const PHONE = '0912 345 678';
const ZALO = '4836251958174629381';
const LEVELS = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;
let out = '';

beforeAll(() => {
  for (const stream of [process.stdout, process.stderr])
    vi.spyOn(stream, 'write').mockImplementation((chunk: string | Uint8Array) => {
      out += String(chunk);
      return true;
    });
  Logger.overrideLogger(new RedactingLogger());
});

afterAll(() => vi.restoreAllMocks());

const leaked = () => [EMAIL, PHONE, ZALO].filter((value) => out.includes(value));

describe('RedactingLogger', () => {
  it('keeps PII out of every level, through an instance and through the static Logger', () => {
    out = '';
    const logger = new Logger('Test');
    for (const level of LEVELS) {
      logger[level](`${level} instance ${EMAIL} ${PHONE} uid ${ZALO}`);
      Logger[level](`${level} static ${EMAIL} ${PHONE} uid ${ZALO}`, 'Test');
    }
    for (const level of LEVELS) {
      expect(out).toContain(`${level} instance <email> <number> uid <number>`);
      expect(out).toContain(`${level} static <email> <number> uid <number>`);
    }
    expect(leaked()).toEqual([]);
  });

  it('redacts a stack, extra fields, an object, and prints an error without the detail of PostgreSQL', () => {
    out = '';
    const logger = new Logger('Test');
    logger.error('request failed', `Error: no user ${EMAIL}\n    at f (x.ts:1:1)`);
    logger.log({ customer: { phone: PHONE } });
    logger.warn('sent', { to: EMAIL });
    const pg = Object.assign(new Error('violates check constraint "customers_phone_e164_check"'), {
      code: '23514',
      detail: `Failing row contains (${PHONE}, ${ZALO}).`,
    });
    logger.error(pg);
    expect(out).toContain('Error: no user <email>');
    expect(out).toContain('Error 23514: violates check constraint "customers_phone_e164_check"');
    expect(out).not.toContain('Failing row');
    expect(leaked()).toEqual([]);
  });
});
