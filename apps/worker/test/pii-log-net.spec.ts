import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { uuidv7 } from '@gani/domain';
import { describe, expect, it } from 'vitest';

import { API_ORIGIN, spawnApi } from './api.js';
import { requireEnv, waitFor } from './harness.js';
import { useQueueSuite } from './suite.js';

// No PII in a log (CLAUDE.md rule 5), on real processes: what Better Auth logs about a refused URL, through the API built from
// dist/main.js (RedactingLogger), and a crash on a PostgreSQL error whose `detail` holds a phone number (the crash handlers of main).
// Every case reads everything the process printed, stdout and stderr.
const suite = useQueueSuite();
const EMAIL = 'an.nguyen@example.test';
const PHONE = '0912345678';
const ZALO = '4836251958174629381';
const leaks = (output: string) => [EMAIL, PHONE, ZALO].filter((value) => output.includes(value));

describe('no PII in a log', () => {
  it('a sign-in whose callbackURL carries PII is refused, and the API logs the refusal with the PII masked', async () => {
    const api = await spawnApi(randomBytes(32).toString('hex'));
    try {
      const res = await fetch(`${api.url}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: API_ORIGIN },
        body: JSON.stringify({
          email: EMAIL,
          password: 'not-the-password-1',
          callbackURL: `https://evil.example/u/${EMAIL}/${PHONE}?email=${EMAIL}&zalo=${ZALO}`,
        }),
      });
      expect(res.status).toBe(403);
      await waitFor(() => Promise.resolve(api.output().includes('Invalid callbackURL')), {
        timeoutMs: 5000,
        label: 'the API to log the refused callbackURL',
        report: false,
      });
      expect(api.output()).toContain(
        'Invalid callbackURL: https://evil.example/u/<email>/<number>?<query>',
      );
      expect(leaks(api.output())).toEqual([]);
    } finally {
      await api.stop();
    }
  });

  it.each(['unhandledRejection', 'uncaughtException'])(
    'a crash on %s prints the PostgreSQL error without its detail, and exits with 1',
    async (event) => {
      const org = await suite.newOrg();
      const child = spawn(
        process.execPath,
        [join(dirname(fileURLToPath(import.meta.url)), 'support/crash-pii.mjs')],
        {
          env: {
            PATH: process.env['PATH'],
            DATABASE_URL_MIGRATION: requireEnv('DATABASE_URL_MIGRATION'),
            CRASH_EVENT: event,
            ORG_ID: org,
            CUSTOMER_ID: uuidv7(),
            PHONE,
          },
        },
      );
      let output = '';
      for (const stream of [child.stdout, child.stderr])
        stream.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
      const code = await new Promise<number | null>((done) => child.once('close', done));
      expect(code).toBe(1);
      // `error` is the name pg gives its DatabaseError.
      expect(output).toContain(
        `${event}: error 23514: new row for relation "customers" violates check constraint "customers_phone_check"`,
      );
      expect(output).not.toContain('Failing row');
      expect(leaks(output)).toEqual([]);
    },
  );
});
