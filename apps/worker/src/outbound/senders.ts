import type { ChannelSenders } from './outbound-sender.js';

/**
 * The senders of each channel type (O3: Zalo, packages/channels). None yet: the Zalo send API waits for Q6, so this gives no sender
 * and readConfig refuses OUTBOUND_ENABLED=1 (N185). O3 adds the Zalo sender here, marked `// Q6: unverified`, and lifts that refusal.
 */
export function createChannelSenders(): ChannelSenders {
  return {};
}
