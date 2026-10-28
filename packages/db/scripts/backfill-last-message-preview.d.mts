export const BATCH_SIZE: number;

export function backfillLastMessagePreview(options: {
  connectionString: string;
  /** One organisation only; null or absent: every organisation. */
  orgId?: string | null;
  /** Only count the conversations it would fill; writes nothing. */
  dryRun?: boolean;
  /** Conversations per transaction (default BATCH_SIZE). */
  batchSize?: number;
  /** Where the counts go (default console.log): never a text, a customer or a conversation. */
  log?: (line: string) => void;
}): Promise<{ total: number; processed: number; updated: number; dryRun: boolean }>;
