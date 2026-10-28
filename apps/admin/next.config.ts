import path from 'node:path';

import type { NextConfig } from 'next';

// The admin and the API answer on one public origin (BETTER_AUTH_URL, N136): the browser calls /api/auth and /v1 on the admin's
// origin. In development these rewrites forward them to the API; in production the reverse proxy of the deployment does.
// API_ORIGIN is read by `next build` and baked into the rewrites: changing it requires a rebuild (infra/docker/Dockerfile.admin).
const api = process.env['API_ORIGIN'] ?? 'http://localhost:3000';

const config: NextConfig = {
  poweredByHeader: false,
  // The image of infra/docker/Dockerfile.admin runs .next/standalone; tracing starts at the repository root of the monorepo
  // (`next build` runs in apps/admin).
  output: 'standalone',
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
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
