import type { OutboundClaim } from '@gani/db';
import { describe, expect, it, vi } from 'vitest';

import { OutboundSenderJob, type ChannelSender } from './outbound-sender.js';

// The outbound worker over a fake store and a fake channel (O2): what it sends, what it writes after, and what it never does (send
// through a closed window, send twice, log a message).
const SETTINGS = {
  pollMs: 10,
  leaseSeconds: 60,
  timeoutMs: 50,
  maxAttempts: 5,
  orgsPerTick: 2,
  orgParallel: 1,
};
const claimOf = (over: Partial<OutboundClaim> = {}): OutboundClaim => ({
  id: 'd1',
  workspaceId: 'w1',
  conversationId: 'c1',
  messageId: 'm1',
  channelAccountId: 'a1',
  attempts: 1,
  claimedAt: new Date(1000),
  message: { kind: 'text', body: 'secret words', sequenceNumber: 4 },
  externalUserId: 'zu',
  account: {
    type: 'zalo_oa',
    status: 'connected',
    externalAccountId: 'oa',
    accessTokenEnc: null,
    keyVersion: 1,
  },
  ...over,
});

function setup(claims: (OutboundClaim | null)[] = [claimOf()], sender?: Partial<ChannelSender>) {
  const queue = [...claims];
  const store = {
    pendingOrgs: vi.fn(() => Promise.resolve(['o1'])),
    workspaces: vi.fn(() => Promise.resolve(['w1'])),
    claim: vi.fn(() => Promise.resolve(queue.shift() ?? null)),
    window: vi.fn(() => Promise.resolve<'open' | 'closed'>('open')),
    complete: vi.fn(() => Promise.resolve(true)),
    retry: vi.fn(() => Promise.resolve(true)),
    fail: vi.fn(() => Promise.resolve(true)),
  };
  const send = vi.fn(() => Promise.resolve({ ok: true as const, platformMessageId: 'p1' }));
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const metrics = { delivered: vi.fn() };
  const job = new OutboundSenderJob({
    store: store,
    senders: { zalo_oa: { send, ...sender } },
    log,
    settings: SETTINGS,
    shutdownMs: 100,
    metrics,
    now: () => new Date(5000),
  });
  return { job, store, send, log, metrics };
}
const KEY = { id: 'd1', claimedAt: new Date(1000) };

describe('OutboundSenderJob.tick', () => {
  it('re-checks the window, sends outside the claim, and writes sent with the platform id', async () => {
    const t = setup();
    expect(await t.job.tick()).toBe(false);
    expect(t.store.claim).toHaveBeenCalledWith('o1', 'w1', 60);
    expect(t.store.window).toHaveBeenCalledWith('o1', claimOf(), new Date(5000));
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.store.complete).toHaveBeenCalledWith('o1', 'w1', KEY, 'p1');
    expect(t.metrics.delivered).toHaveBeenCalledWith('sent');
    // Ids only: the text of the message never reaches a log line.
    expect(JSON.stringify(t.log.info.mock.calls)).not.toContain('secret words');
    expect(t.log.info).toHaveBeenCalledWith('outbound_sent', {
      orgId: 'o1',
      workspaceId: 'w1',
      deliveryId: 'd1',
      messageId: 'm1',
    });
  });

  it('fails at once, without sending, when the window closed meanwhile', async () => {
    const t = setup();
    t.store.window.mockResolvedValueOnce('closed');
    await t.job.tick();
    expect(t.send).not.toHaveBeenCalled();
    expect(t.store.fail).toHaveBeenCalledWith('o1', 'w1', KEY, 'CHANNEL_WINDOW_CLOSED');
    expect(t.metrics.delivered).toHaveBeenCalledWith('failed');
  });

  it('retries a failure with the relay backoff, and fails it at the last attempt', async () => {
    const down = {
      send: () => Promise.resolve({ ok: false as const, code: 'E_NET', retry: true }),
    };
    const t = setup([claimOf({ attempts: 3 })], down);
    await t.job.tick();
    expect(t.store.retry).toHaveBeenCalledWith('o1', 'w1', KEY, {
      errorCode: 'E_NET',
      delaySeconds: 8,
    });
    expect(t.log.warn).toHaveBeenCalledWith(
      'outbound_retry',
      expect.objectContaining({ code: 'E_NET', attempts: 3 }),
    );
    const last = setup([claimOf({ attempts: 5 })], down);
    await last.job.tick();
    expect(last.store.retry).not.toHaveBeenCalled();
    expect(last.store.fail).toHaveBeenCalledWith('o1', 'w1', KEY, 'E_NET');
  });

  it('fails a refusal that no retry can help, and keeps only a code', async () => {
    const t = setup([claimOf()], {
      send: () => Promise.resolve({ ok: false as const, code: 'E_REFUSED', retry: false }),
    });
    await t.job.tick();
    expect(t.store.fail).toHaveBeenCalledWith('o1', 'w1', KEY, 'E_REFUSED');
    const odd = setup([claimOf()], {
      send: () => Promise.resolve({ ok: false as const, code: 'bad text', retry: true }),
    });
    await odd.job.tick();
    expect(odd.store.retry).toHaveBeenCalledWith(
      'o1',
      'w1',
      KEY,
      expect.objectContaining({ errorCode: 'E_SEND_CLIENT' }),
    );
  });

  it('cuts a call at the timeout, and turns a throw into a code', async () => {
    const slow = setup([claimOf()], { send: () => new Promise(() => undefined) });
    await slow.job.tick();
    expect(slow.store.retry).toHaveBeenCalledWith(
      'o1',
      'w1',
      KEY,
      expect.objectContaining({ errorCode: 'E_SEND_TIMEOUT' }),
    );
    const boom = setup([claimOf()], { send: () => Promise.reject(new Error('socket')) });
    await boom.job.tick();
    expect(boom.store.retry).toHaveBeenCalledWith(
      'o1',
      'w1',
      KEY,
      expect.objectContaining({ errorCode: 'E_SEND_CLIENT' }),
    );
  });

  it('does not send to an account that is gone or down, nor without a person or a sender for its type', async () => {
    for (const claim of [
      claimOf({ account: null }),
      claimOf({ account: { ...claimOf().account!, status: 'disconnected' } }),
      claimOf({ externalUserId: null }),
    ]) {
      const t = setup([claim]);
      await t.job.tick();
      expect(t.send).not.toHaveBeenCalled();
      expect(t.store.retry).toHaveBeenCalledWith(
        'o1',
        'w1',
        KEY,
        expect.objectContaining({ errorCode: 'E_CHANNEL_UNAVAILABLE' }),
      );
    }
    const t = setup([claimOf({ account: { ...claimOf().account!, type: 'facebook' } })]);
    await t.job.tick();
    expect(t.store.retry).toHaveBeenCalledWith('o1', 'w1', KEY, {
      errorCode: 'E_NO_SENDER',
      delaySeconds: 300,
    });
  });

  it('logs a lost claim without counting it as sent', async () => {
    const t = setup();
    t.store.complete.mockResolvedValueOnce(false);
    await t.job.tick();
    expect(t.log.warn).toHaveBeenCalledWith(
      'outbound_lease_lost',
      expect.objectContaining({ deliveryId: 'd1' }),
    );
    expect(t.metrics.delivered).toHaveBeenCalledWith('lease_lost');
    expect(t.metrics.delivered).not.toHaveBeenCalledWith('sent');
  });

  it('goes round every workspace, claims until none is left, says when there is more, and survives an organisation that fails', async () => {
    const t = setup([
      claimOf(),
      claimOf({ id: 'd2' }),
      null,
      claimOf({ id: 'd3', workspaceId: 'w2' }),
    ]);
    t.store.workspaces.mockResolvedValueOnce(['w1', 'w2']);
    t.store.pendingOrgs.mockResolvedValueOnce(['o1', 'o2']);
    t.store.workspaces.mockRejectedValueOnce(new Error('db down'));
    expect(await t.job.tick()).toBe(true);
    expect(t.send).toHaveBeenCalledTimes(3);
    expect(t.log.error).toHaveBeenCalledWith('outbound_org_failed', {
      orgId: 'o2',
      error: 'Error',
    });
  });
});

describe('OutboundSenderJob loop', () => {
  it('starts once, stops after the pass in progress, and reports a stop that runs late', async () => {
    const t = setup([]);
    expect(await t.job.stop()).toBe(true);
    const job = setup([]).job;
    job.start();
    expect(() => job.start()).toThrow('already started');
    expect(await job.stop()).toBe(true);
    const stuck = setup([]);
    stuck.store.pendingOrgs.mockReturnValue(new Promise(() => undefined));
    stuck.job.start();
    expect(await stuck.job.stop()).toBe(false);
    expect(stuck.log.warn).toHaveBeenCalledWith('outbound_shutdown_timeout', { shutdownMs: 100 });
  });

  it('logs a pass that fails and goes on', async () => {
    const t = setup([]);
    t.store.pendingOrgs.mockRejectedValueOnce(new Error('db down'));
    t.job.start();
    await vi.waitFor(() => expect(t.store.pendingOrgs.mock.calls.length).toBeGreaterThan(1));
    expect(t.log.error).toHaveBeenCalledWith('outbound_tick_failed', { error: 'Error' });
    expect(await t.job.stop()).toBe(true);
  });
});
