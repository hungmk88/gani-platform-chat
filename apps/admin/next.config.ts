import type { NextConfig } from 'next';

// The admin and the API answer on one public origin (BETTER_AUTH_URL, N136): the browser calls /api/auth and /v1 on the admin's
// origin. In development these rewrites forward them to the API; in production the reverse proxy of the deployment does.
const api = process.env['API_ORIGIN'] ?? 'http://localhost:3000';

const config: NextConfig = {
  poweredByHeader: false,
  // `next build` type-checks with tsconfig.build.json: the same as tsconfig.json without rules-sync.test.ts (#378), which reads the
  // API's source and its types need @gani/db built, and the admin's e2e job builds only the admin's own dependencies.
  // `pnpm typecheck` (tsconfig.json, in the job that builds every package) still checks that test.
  typescript: { tsconfigPath: 'tsconfig.build.json' },
  rewrites: () =>
    Promise.resolve([
      { source: '/api/auth/:path*', destination: `${api}/api/auth/:path*` },
      { source: '/v1/:path*', destination: `${api}/v1/:path*` },
    ]),
};

export default config;
