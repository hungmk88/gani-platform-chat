import { afterEach, describe, expect, it, vi } from 'vitest';

import { pingDb } from './ping.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('pingDb', () => {
  it('is true when SELECT 1 succeeds, and sends exactly that query', async () => {
    const query = vi.fn(() => Promise.resolve({ rows: [] }));
    expect(await pingDb({ query })).toBe(true);
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('is false when the query rejects, without exposing the reason', async () => {
    const query = () =>
      Promise.reject(new Error('password authentication failed for user app_role'));
    expect(await pingDb({ query })).toBe(false);
  });

  it('is false when the stub throws before returning a promise', async () => {
    const query = (): Promise<unknown> => {
      throw new Error('boom');
    };
    expect(await pingDb({ query })).toBe(false);
  });

  it('is false when the database does not answer in time, and leaves no timer behind', async () => {
    vi.useFakeTimers();
    const hang = new Promise<never>(() => undefined);
    const answer = pingDb({ query: () => hang }, 500);
    await vi.advanceTimersByTimeAsync(500);
    expect(await answer).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timer when the query answers first', async () => {
    vi.useFakeTimers();
    expect(await pingDb({ query: () => Promise.resolve() }, 500)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not raise an unhandled rejection when the query fails after the timeout', async () => {
    vi.useFakeTimers();
    let fail: (reason: Error) => void = () => undefined;
    const late = new Promise<never>((_resolve, reject) => {
      fail = reject;
    });
    const answer = pingDb({ query: () => late }, 100);
    await vi.advanceTimersByTimeAsync(100);
    expect(await answer).toBe(false);
    fail(new Error('too late'));
    await vi.advanceTimersByTimeAsync(0);
  });
});
