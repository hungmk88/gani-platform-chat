// The load of K3: something that writes at a steady pace while the test does other things (kills the worker, starts another).
export interface Producer {
  /**
   * Stops the loop and waits for the write in flight to commit or fail, so that when it returns nothing is being written any more and a
   * `SELECT` sees every event that will ever exist. A write that failed is thrown here: a producer that lost a write must not pass.
   */
  stop(): Promise<void>;
}

/**
 * Calls `write` every `everyMs`, one after the other, paced by the monotonic clock (`performance.now`) so that a slow write does not
 * slow the average down: the next call is due at a multiple of `everyMs` from the start, and comes at once if it is late.
 */
export function startProducer(write: () => Promise<unknown>, everyMs: number): Producer {
  let stopping = false;
  let failure: unknown;
  const loop = (async () => {
    let due = performance.now();
    while (!stopping) {
      try {
        await write();
      } catch (error) {
        failure = error;
        return;
      }
      due += everyMs;
      const wait = due - performance.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
  })();
  return {
    async stop() {
      stopping = true;
      await loop;
      if (failure !== undefined)
        throw new Error('the producer could not write', { cause: failure });
    },
  };
}
