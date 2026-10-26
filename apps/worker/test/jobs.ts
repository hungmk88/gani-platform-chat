import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

const iso = (ms: number | undefined): string => (ms ? new Date(ms).toISOString() : '-');

/**
 * Where BullMQ holds each job given, for the message of a test that waited in vain for a consumer: the state of the job (`active`,
 * `wait`, `delayed`, `failed`, `completed`, or `missing` when the queue has no such job), its attempts and stalls, and whether a
 * worker still holds its lock. The counts of the queue come first. A job `completed` before the kill was handled by the killed worker,
 * whose log line was lost with the process (a pipe written asynchronously). Ids and codes only: no payload.
 */
export async function describeJobs(
  redisUrl: string,
  queueName: string,
  jobIds: readonly string[],
  max = 20,
): Promise<string> {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  connection.on('error', () => undefined);
  const queue = new Queue(queueName, { connection });
  try {
    const counts = await queue.getJobCounts();
    const stalledSet = await connection.scard(`bull:${queueName}:stalled`);
    const checkTtl = await connection.pttl(`bull:${queueName}:stalled-check`);
    const lines = [
      `queue ${queueName}: ${JSON.stringify(counts)} stalled-set=${stalledSet} stalled-check-ttl-ms=${checkTtl}`,
    ];
    for (const id of jobIds.slice(0, max)) {
      const job = await queue.getJob(id);
      if (!job) {
        lines.push(`  job ${id}: missing`);
        continue;
      }
      const lockTtl = await connection.pttl(`bull:${queueName}:${id}:lock`);
      // prettier-ignore
      lines.push(`  job ${id}: ${await job.getState()} attemptsMade=${job.attemptsMade} stalledCounter=${job.stalledCounter} processedOn=${iso(job.processedOn)} finishedOn=${iso(job.finishedOn)} lock-ttl-ms=${lockTtl} failedReason=${(job.failedReason ?? '-').slice(0, 60)}`);
    }
    if (jobIds.length > max) lines.push(`  ... and ${jobIds.length - max} more`);
    return lines.join('\n');
  } finally {
    await queue.close().catch(() => undefined);
    connection.disconnect();
  }
}
