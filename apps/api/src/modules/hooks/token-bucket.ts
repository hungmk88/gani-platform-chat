// Rate limit of the webhook (zalo spec §3, Z7): a token bucket per channel account, in this process's memory. Several API instances
// each have their own buckets, so the real limit multiplies: accepted for wave 1 (against spam, not a cost control).

export interface BucketOptions {
  readonly perSecond: number;
  readonly burst: number;
  /** Buckets kept at most; the oldest is dropped first, so a flood of made-up ids cannot grow the map without end. */
  readonly maxKeys?: number;
}

export class TokenBuckets {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(private readonly options: BucketOptions) {}

  /** Takes one token for `key` at `nowMs`; false when the bucket is empty. */
  take(key: string, nowMs: number): boolean {
    const { perSecond, burst, maxKeys = 10_000 } = this.options;
    const bucket = this.buckets.get(key) ?? { tokens: burst, at: nowMs };
    bucket.tokens = Math.min(burst, bucket.tokens + ((nowMs - bucket.at) / 1000) * perSecond);
    bucket.at = nowMs;
    this.buckets.delete(key);
    this.buckets.set(key, bucket);
    if (this.buckets.size > maxKeys)
      this.buckets.delete(this.buckets.keys().next().value as string);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }
}
