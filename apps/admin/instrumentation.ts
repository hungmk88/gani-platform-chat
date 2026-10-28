// Runs once when the Next.js server starts. API_ORIGIN was baked into the rewrites at build time (next.config.ts); the image sets
// the same value at run time so it can be checked here. In production /v1 and /api/auth normally go through the reverse proxy and
// the rewrites are not used, so the default only earns a warning, never a failed start.
const DEFAULT_IMAGE_API_ORIGIN = 'http://api:3000';

export function register(): void {
  if (
    process.env['NODE_ENV'] === 'production' &&
    process.env['API_ORIGIN'] === DEFAULT_IMAGE_API_ORIGIN
  ) {
    console.warn(
      `admin_api_origin_default: the rewrites of /v1 and /api/auth point at ${DEFAULT_IMAGE_API_ORIGIN}; without a reverse proxy, rebuild the image with --build-arg API_ORIGIN=<API origin>`,
    );
  }
}
