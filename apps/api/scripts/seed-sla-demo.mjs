// Demo data of the SLA for the Inbox (CEO brief 11): `pnpm --filter @gani/api build` first, then
//   APP_ENV=development DATABASE_URL_MIGRATION=<...> DATABASE_URL_APP=<...> pnpm --filter @gani/api seed:sla-demo
// Refused on any APP_ENV but development and staging. Prints the ids, the email and the password of the demo person ONCE, on this
// terminal only: nothing else keeps the password.
import console from 'node:console';
import process from 'node:process';

import { createDbPool } from '@gani/db';

import { SeedRefusedError, readSeedEnv, seedSlaDemo } from '../dist/ops/seed-sla-demo.js';

async function main() {
  const { migrationUrl, appUrl } = readSeedEnv(process.env);
  const [admin, app] = [createDbPool(migrationUrl, { max: 1 }), createDbPool(appUrl, { max: 1 })];
  try {
    const demo = await seedSlaDemo(admin, app);
    console.log(
      JSON.stringify({
        event: 'sla_demo_seeded',
        orgId: demo.orgId,
        conversations: demo.conversations,
        more: demo.more,
      }),
    );
    console.log(`Sign in (shown once): ${demo.email} / ${demo.password}`);
    return 0;
  } finally {
    await Promise.all([admin.end(), app.end()]);
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    if (error instanceof SeedRefusedError)
      console.log(JSON.stringify({ event: 'sla_demo_refused', reason: error.reason }));
    // A driver message can name the host or the role: only the code goes out.
    else
      console.log(
        JSON.stringify({ event: 'sla_demo_failed', code: error?.code ?? error?.name ?? 'unknown' }),
      );
    process.exit(1);
  },
);
