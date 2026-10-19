export const LOCK_TIMEOUT_MS: number;
export const LOCK_ATTEMPTS: number;
export const RETRY_DELAY_MS: number;

export function migrate(options: {
  connectionString: string;
  dir?: string;
  table?: string;
  /** lock_timeout of each transactional file, in whole milliseconds (default LOCK_TIMEOUT_MS). */
  lockTimeoutMs?: number;
  /** How many times a file that could not get its locks is tried (default LOCK_ATTEMPTS). */
  attempts?: number;
  /** Wait before the second attempt, doubled before each later one (default RETRY_DELAY_MS). */
  retryDelayMs?: number;
}): Promise<string[]>;
