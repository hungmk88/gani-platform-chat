import type { ChannelPolicyRow, TenantTx, WindowFactsRow } from '@gani/db';
import { describe, expect, it, vi } from 'vitest';

import { ChannelPolicyService, type ChannelWindowReads } from './channel-policy-service.js';
import { ChannelWindowClosedError, ConversationNotFoundError } from './errors.js';

// The gate of channel-policy-spec §3 over fake reads: what it asks (the policy in force at `now`, for the class of the message), and
// what it lets through (open only). The rule itself is the real windowState of the domain package.
const TX = {} as TenantTx;
const LAST = new Date('2026-10-20T08:00:00Z');
const at = (hours: number) => new Date(LAST.getTime() + hours * 3_600_000);
const ADVISORY: ChannelPolicyRow = {
  id: 'p-1',
  freeWindowSeconds: 172_800,
  freeMessageQuota: 8,
  outsideWindowAllowed: true,
  note: 'tạm, chờ xác nhận',
};

function service(
  facts: Partial<WindowFactsRow> | null,
  policy: ChannelPolicyRow | null = ADVISORY,
) {
  const reads = {
    loadWindowFacts: vi.fn<ChannelWindowReads['loadWindowFacts']>(() =>
      Promise.resolve(
        facts && {
          channelType: 'zalo_oa',
          lastCustomerMessageAt: LAST,
          officialMessagesSinceCustomer: 0,
          ...facts,
        },
      ),
    ),
    readChannelPolicy: vi.fn<ChannelWindowReads['readChannelPolicy']>(() =>
      Promise.resolve(policy),
    ),
  };
  return { reads, gate: new ChannelPolicyService(reads) };
}
const refusal = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof ChannelWindowClosedError ? e.problemExtensions : e),
  );

describe('ChannelPolicyService.check', () => {
  it('C-N1: lets an advisory reply through inside the window, reading the policy in force at that moment', async () => {
    const { reads, gate } = service({ officialMessagesSinceCustomer: 3 });
    expect(await gate.check(TX, 'c-1', at(1))).toEqual({ state: 'open', reason: 'within_window' });
    expect(reads.loadWindowFacts).toHaveBeenCalledWith(TX, 'c-1');
    expect(reads.readChannelPolicy).toHaveBeenCalledWith(TX, 'zalo_oa', 'advisory', at(1));
  });

  it('C-N4: refuses outside the window and past the quota, paid_only included (C3), with a 422', async () => {
    const outside = service({});
    const error = await outside.gate.check(TX, 'c-1', at(48)).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 422, code: 'channel_window_closed' });
    expect(error).toBeInstanceOf(ChannelWindowClosedError);
    expect(await refusal(outside.gate.check(TX, 'c-1', at(48)))).toEqual({
      windowState: 'paid_only',
      reason: 'window_expired',
    });
    expect(
      await refusal(service({ officialMessagesSinceCustomer: 8 }).gate.check(TX, 'c-1', at(1))),
    ).toEqual({
      windowState: 'paid_only',
      reason: 'quota_exhausted',
    });
    expect(
      await refusal(service({ lastCustomerMessageAt: null }).gate.check(TX, 'c-1', at(1))),
    ).toEqual({
      windowState: 'paid_only',
      reason: 'no_customer_message',
    });
  });

  it('C-N6: decides by the policy it read, not by a fixed 48 hours', async () => {
    const hour = { ...ADVISORY, freeWindowSeconds: 3600 };
    expect(await refusal(service({}, hour).gate.check(TX, 'c-1', at(2)))).toEqual({
      windowState: 'paid_only',
      reason: 'window_expired',
    });
    const closed = { ...ADVISORY, outsideWindowAllowed: false };
    expect(await refusal(service({}, closed).gate.check(TX, 'c-1', at(49)))).toEqual({
      windowState: 'api_closed',
      reason: 'window_expired',
    });
  });

  it('refuses a conversation without a channel and a channel with no policy (no_policy, fail-closed)', async () => {
    const none = { windowState: 'api_closed', reason: 'no_policy' };
    const noChannel = service({ channelType: null });
    expect(await refusal(noChannel.gate.check(TX, 'c-1', at(1)))).toEqual(none);
    expect(noChannel.reads.readChannelPolicy).not.toHaveBeenCalled();
    expect(await refusal(service({}, null).gate.check(TX, 'c-1', at(1)))).toEqual(none);
  });

  it('answers a conversation it cannot see as not found', async () => {
    await expect(service(null).gate.check(TX, 'c-1', at(1))).rejects.toBeInstanceOf(
      ConversationNotFoundError,
    );
  });
});
