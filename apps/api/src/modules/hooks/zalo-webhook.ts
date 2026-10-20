import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  parseZaloEvent,
  verifyZaloSignature,
  zaloPlatformMessageId,
  ZALO_SIGNATURE_HEADER,
  type SecretBox,
} from '@gani/channels';
import type { NewInboundEvent, TenantContext, TenantTx, WebhookChannelAccount } from '@gani/db';
import { uuidv7 } from '@gani/domain';
import { Logger } from '@nestjs/common';

import { problem, sendProblem } from '../request-context/problem.js';
import { TokenBuckets } from './token-bucket.js';

// POST /v1/hooks/zalo/{channelAccountId} (Brief P9, zalo spec §3, inbound spec §1). Mounted before every parser and outside the
// tenant middleware: the signature is computed over the raw bytes, and the tenant comes from the channel account, never from the
// body. Steps, each one stops at a failure and writes nothing: raw body (≤ 256 KiB) → channel account → decrypt the OA secret key →
// signature → insertIfAbsent in the tenant of the account → 200, a second delivery included. An unknown, deleted or disconnected
// account and a bad signature get the same answer (401 for now, Z3 open), so nobody learns which accounts exist. The log holds ids
// and a code only: never the body, the signature or a secret.

export const WEBHOOK_MAX_BYTES = 256 * 1024;
const REFUSED = 'The webhook could not be verified.';

export interface ZaloWebhookDeps {
  readonly account: (channelAccountId: string) => Promise<WebhookChannelAccount | null>;
  readonly secrets: SecretBox;
  readonly withTenant: <T>(ctx: TenantContext, fn: (tx: TenantTx) => Promise<T>) => Promise<T>;
  readonly insert: (tx: TenantTx, event: NewInboundEvent) => Promise<'inserted' | 'duplicate'>;
  readonly now?: () => Date;
  readonly buckets?: TokenBuckets;
}

type Req = IncomingMessage & { params?: Record<string, string> };

class TooLarge extends Error {}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > limit) return reject(new TooLarge());
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        req.removeAllListeners('data');
        req.resume();
        reject(new TooLarge());
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function createZaloWebhook(deps: ZaloWebhookDeps) {
  const logger = new Logger('ZaloWebhook');
  const now = deps.now ?? (() => new Date());
  const buckets = deps.buckets ?? new TokenBuckets({ perSecond: 100, burst: 200 });

  const handle = async (req: Req, res: ServerResponse): Promise<void> => {
    const traceId = randomUUID();
    const channelAccountId = req.params?.['channelAccountId'] ?? '';
    const refuse = (code: string) => {
      logger.warn(
        `webhook refused (${code}) channelAccount=${channelAccountId.slice(0, 36)} trace=${traceId}`,
      );
      sendProblem(res, problem(401, 'unauthorized', REFUSED, traceId));
    };
    if (!buckets.take(channelAccountId, now().getTime()))
      return sendProblem(res, problem(429, 'rate_limited', undefined, traceId));
    let raw: Buffer;
    try {
      raw = await readBody(req, WEBHOOK_MAX_BYTES);
    } catch (error) {
      if (error instanceof TooLarge)
        return sendProblem(res, problem(413, 'payload_too_large', undefined, traceId));
      throw error;
    }
    const account = await deps.account(channelAccountId).catch((error: unknown) => {
      if (error instanceof Error && /channelAccountId/.test(error.message)) return null; // not a UUID: an unknown account
      throw error;
    });
    if (!account || account.status === 'disconnected' || account.type !== 'zalo_oa')
      return refuse('E_UNKNOWN_CHANNEL');
    if (!account.appId || !account.oaSecretKeyEnc) return refuse('E_CHANNEL_NOT_SET_UP');
    const oaSecretKey = deps.secrets.decrypt(
      account.oaSecretKeyEnc,
      { rowId: channelAccountId, column: 'oa_secret_key_enc' },
      account.keyVersion,
    );
    const event = parseZaloEvent(raw);
    const header = req.headers[ZALO_SIGNATURE_HEADER];
    const signed =
      event !== null &&
      verifyZaloSignature({
        rawBody: raw,
        header: typeof header === 'string' ? header : undefined,
        event,
        secrets: { appId: account.appId, oaSecretKey },
        now: now(),
      });
    if (!event || !signed) return refuse('E_BAD_SIGNATURE');
    const platformMessageId = zaloPlatformMessageId(event, raw);
    const tenant = { orgId: account.orgId, workspaceIds: [account.workspaceId] };
    const result = await deps.withTenant(tenant, (tx) =>
      deps.insert(tx, {
        id: uuidv7(),
        workspaceId: account.workspaceId,
        channelAccountId,
        platformMessageId,
        eventType: event.eventName,
        payload: event.raw,
      }),
    );
    logger.log(`webhook ${result} channelAccount=${channelAccountId} trace=${traceId}`);
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end('{"ok":true}');
  };
  // Anything that fails past the checks (the database, a secret that does not decrypt) is a 500 with a code in the log: Zalo sends
  // again, and the key of inbound_event_keys keeps a second delivery from becoming a second event.
  return (req: Req, res: ServerResponse): Promise<void> =>
    handle(req, res).catch((error: unknown) => {
      const named = error instanceof Error ? (error as { code?: unknown }).code : undefined;
      const code =
        typeof named === 'string' ? named : error instanceof Error ? error.name : 'unknown';
      const traceId = randomUUID();
      logger.error(`webhook failed (${code.slice(0, 64)}) trace=${traceId}`);
      if (!res.headersSent) sendProblem(res, problem(500, 'internal_error', undefined, traceId));
      else res.end();
    });
}
