import { createHash, timingSafeEqual } from 'node:crypto';

// The Zalo OA webhook (zalo-channel spec §3, §7). Q6 IS NOT DONE: nothing here is checked against Zalo's own documentation. The
// signature formula (Z-a) comes from secondary sources, where the timestamp comes from (Z-b) and the names and fields of the events
// (Z-e) from none at all; they are what the fixtures of the tests assume (N100(1), N139). Every such line says `Q6: unverified`.
// Rework them, and the fixtures, against the official documents before S3 closes.

export const ZALO_SIGNATURE_HEADER = 'x-zevent-signature';
/** How far the timestamp of a webhook may be from now, either way (WEBHOOK_TIMESTAMP_TOLERANCE_S). */
export const ZALO_TIMESTAMP_TOLERANCE_S = 300;

export interface ZaloSecrets {
  readonly appId: string;
  /** The OA secret key, decrypted by SecretBox. Never logged. */
  readonly oaSecretKey: string;
}

/** A webhook body this code can read: JSON with the fields the checks need. Anything else is refused like a bad signature. */
export interface ZaloEvent {
  readonly eventName: string;
  /** Milliseconds since the epoch, as Zalo sends it (Q6: unverified, Z-b: taken from the body's `timestamp`). */
  readonly timestamp: string;
  readonly raw: Record<string, unknown>;
}

export function parseZaloEvent(rawBody: Buffer): ZaloEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const eventName = body['event_name']; // Q6: unverified (Z-e)
  const timestamp = body['timestamp']; // Q6: unverified (Z-b)
  if (typeof eventName !== 'string' || eventName === '') return null;
  if (typeof timestamp !== 'string' && typeof timestamp !== 'number') return null;
  if (!/^[0-9]{10,16}$/.test(String(timestamp))) return null;
  return { eventName, timestamp: String(timestamp), raw: body };
}

/**
 * Is this webhook from Zalo for this OA? `mac=` + sha256(appId + raw body + timestamp + OA secret key), compared in constant time
 * (Q6: unverified, Z-a: a plain hash of the concatenation, not an HMAC), and the timestamp within the tolerance of `now`. False for
 * anything missing or malformed: the caller answers every refusal alike.
 */
export function verifyZaloSignature(input: {
  readonly rawBody: Buffer;
  readonly header: string | undefined;
  readonly event: ZaloEvent;
  readonly secrets: ZaloSecrets;
  readonly now: Date;
  readonly toleranceS?: number;
}): boolean {
  const { rawBody, header, event, secrets, now } = input;
  if (header === undefined || !/^mac=[0-9a-f]{64}$/i.test(header)) return false;
  const skewS = Math.abs(now.getTime() - Number(event.timestamp)) / 1000;
  if (!(skewS <= (input.toleranceS ?? ZALO_TIMESTAMP_TOLERANCE_S))) return false;
  const expected = zaloSignature(rawBody, event.timestamp, secrets);
  return timingSafeEqual(Buffer.from(header.toLowerCase(), 'utf8'), Buffer.from(expected, 'utf8'));
}

/** The header value for a body (Q6: unverified, Z-a). Exported for the fixtures of the tests, which sign as Zalo would. */
export function zaloSignature(rawBody: Buffer, timestamp: string, secrets: ZaloSecrets): string {
  const hash = createHash('sha256')
    .update(secrets.appId)
    .update(rawBody)
    .update(timestamp)
    .update(secrets.oaSecretKey)
    .digest('hex');
  return `mac=${hash}`;
}
