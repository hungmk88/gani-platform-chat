import type { NextConfig } from 'next';

// The admin and the API answer on one public origin (BETTER_AUTH_URL, N136): the browser calls /api/auth and /v1 on the admin's
// origin. In development these rewrites forward them to the API; in production the reverse proxy of the deployment does.
const api = process.env['API_ORIGIN'] ?? 'http://localhost:3000';

const config: NextConfig = {
  poweredByHeader: false,
  rewrites: () =>
    Promise.resolve([
      { source: '/api/auth/:path*', destination: `${api}/api/auth/:path*` },
      { source: '/v1/:path*', destination: `${api}/v1/:path*` },
    ]),
};

export default config;
