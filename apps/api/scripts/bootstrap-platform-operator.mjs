// The first platform operator of an environment (N25, N148): `pnpm --filter @gani/api build` first, then run ONCE from the deploy
// pipeline with DATABASE_URL_MIGRATION, APP_ENV, BOOTSTRAP_OPERATOR_EMAIL and BOOTSTRAP_OPERATOR_PASSWORD (and BOOTSTRAP_OPERATOR_NAME).
// Prints one JSON line: the id and the reason on success, the reason of a refusal otherwise (exit 1). Never the email or the password.
import console from 'node:console';
import process from 'node:process';

import { createDbPool } from '@gani/db';
import { uuidv7 } from '@gani/domain';

import {
  BootstrapRefusedError,
  bootstrapPlatformOperator,
  readBootstrapEnv,
} from '../dist/ops/bootstrap-operator.js';

const say = (line) => console.log(JSON.stringify({ at: new Date().toISOString(), ...line }));

async function main() {
  const input = readBootstrapEnv(process.env);
  const url = process.env.DATABASE_URL_MIGRATION;
  if (!url) {
    say({ event: 'platform_operator_bootstrap_refused', reason: 'database_url_missing' });
    return 1;
  }
  const pool = createDbPool(url, { max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userId = await bootstrapPlatformOperator(client, input, {
      userId: uuidv7(),
      accountId: uuidv7(),
    });
    await client.query('COMMIT');
    say({ event: 'platform_operator_bootstrapped', userId, reason: 'initial bootstrap' });
    return 0;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    if (error instanceof BootstrapRefusedError) {
      say({ event: 'platform_operator_bootstrap_refused', reason: error.reason });
    } else {
      // A driver message can name the host or the role: only the code goes out.
      say({ event: 'platform_operator_bootstrap_failed', code: error?.code ?? 'unknown' });
    }
    process.exit(1);
  },
);
