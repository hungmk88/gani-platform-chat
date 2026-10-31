import type { TokenRefresher } from './token-refresh.js';

/**
 * The platform client of the token refresh (B2-3, packages/channels). There is none yet: the Zalo token API waits for Q6, so this gives
 * null and readConfig refuses CHANNEL_REFRESH_ENABLED=1 (N173). B2-3 builds the client here and lifts that refusal.
 */
export function createTokenRefresher(): TokenRefresher | null {
  return null;
}
