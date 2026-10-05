// Reads and checks the environment of Better Auth once, at start-up (N82). Anything wrong stops the process with a message that says
// what to fix; no message repeats a secret or a URL (a URL can carry a password).
export interface AuthEnv {
  readonly secret: string;
  readonly baseURL: string;
  /** True when the URL is https: cookies then carry `Secure` and the `__Secure-` prefix. */
  readonly secureCookies: boolean;
}

export const MIN_SECRET_LENGTH = 32;
// http is for a developer machine only: it needs one of these APP_ENV values AND AUTH_ALLOW_HTTP=true. Production, staging and an
// unset APP_ENV all need https, flag or not, so a missing variable can never open the door.
const HTTP_ENVS = new Set(['development', 'test']);
const ON = /^(1|true|yes|on)$/i;

function parseBaseUrl(raw: string | undefined): URL {
  let url: URL;
  try {
    url = new URL(raw ?? '');
  } catch {
    throw new Error(
      'BETTER_AUTH_URL is missing or not a URL: set it to the public origin, for example https://app.example.com',
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error('BETTER_AUTH_URL must start with https://');
  if (url.username || url.password)
    throw new Error('BETTER_AUTH_URL must not contain a user name or password');
  if (url.pathname !== '/' || url.search || url.hash)
    throw new Error('BETTER_AUTH_URL must be an origin only, without a path, query or fragment');
  return url;
}

export function loadAuthEnv(env: Record<string, string | undefined>): AuthEnv {
  const secret = env['BETTER_AUTH_SECRET'] ?? '';
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `BETTER_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters (it has ${secret.length}); make one with: openssl rand -hex 32`,
    );
  }
  // The variable beats `telemetry.enabled = false` in code: the library sends data when either is on.
  if (ON.test(env['BETTER_AUTH_TELEMETRY'] ?? '')) {
    throw new Error('BETTER_AUTH_TELEMETRY is on and would send data out: unset it or set it to 0');
  }
  const url = parseBaseUrl(env['BETTER_AUTH_URL']);
  const secureCookies = url.protocol === 'https:';
  if (
    !secureCookies &&
    !(HTTP_ENVS.has(env['APP_ENV'] ?? '') && env['AUTH_ALLOW_HTTP'] === 'true')
  ) {
    throw new Error(
      'BETTER_AUTH_URL must be https. http is accepted only with APP_ENV=development or test and AUTH_ALLOW_HTTP=true',
    );
  }
  return { secret, baseURL: url.origin, secureCookies };
}
