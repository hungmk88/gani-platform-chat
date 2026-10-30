// A test-only process for pii-log-net.spec.ts: it installs the crash handlers as src/main.ts of the worker and of the API do, then
// lets a real PostgreSQL error go uncaught. The row breaks customers_phone_check (not E.164), so the `detail` of the error is "Failing row
// contains (…)" with the phone number in it; with CRASH_IN=message, PostgreSQL puts VALUE in the message itself ("invalid input
// syntax for type uuid: …"). CRASH_EVENT says how it goes uncaught: unhandledRejection or uncaughtException.
import process from 'node:process';
import { setTimeout } from 'node:timers';

import { createDbPool } from '@gani/db';
import { installCrashHandlers } from '@gani/domain';

installCrashHandlers();
const pool = createDbPool(process.env.DATABASE_URL_MIGRATION, { max: 1 });
const insert =
  process.env.CRASH_IN === 'message'
    ? pool.query('SELECT $1::uuid', [process.env.VALUE])
    : pool.query('INSERT INTO customers (id, org_id, phone_e164) VALUES ($1, $2, $3)', [
        process.env.CUSTOMER_ID,
        process.env.ORG_ID,
        process.env.PHONE,
      ]);
if (process.env.CRASH_EVENT === 'uncaughtException')
  void insert.catch((error) =>
    setTimeout(() => {
      throw error;
    }),
  );
