import type { DBAdapter, Where } from 'better-auth/adapters';
import { describe, expect, it, vi } from 'vitest';

import { revokingAdapter } from './revoking-adapter.js';

const AT = new Date('2026-10-05T12:00:00Z');
const LIVE: Where = { field: 'revokedAt', value: null, operator: 'eq' };
const token: Where = { field: 'token', value: 't' };

/** A recording stand-in for the adapter that drizzleAdapter() would return. */
function fake() {
  const inner = {
    id: 'fake',
    create: vi.fn(() => Promise.resolve({})),
    findOne: vi.fn(() => Promise.resolve(null)),
    findMany: vi.fn(() => Promise.resolve([])),
    count: vi.fn(() => Promise.resolve(0)),
    update: vi.fn(() => Promise.resolve(null)),
    updateMany: vi.fn(() => Promise.resolve(2)),
    delete: vi.fn(() => Promise.resolve()),
    deleteMany: vi.fn(() => Promise.resolve(5)),
    consumeOne: vi.fn(() => Promise.resolve(null)),
    incrementOne: vi.fn(() => Promise.resolve(null)),
    transaction: vi.fn((cb: (trx: unknown) => Promise<unknown>) => cb(inner)),
  };
  const adapter = revokingAdapter(
    () => inner as unknown as DBAdapter,
    () => AT,
  )({});
  return { inner, adapter };
}

describe('revokingAdapter: a session is revoked, never deleted', () => {
  it('turns delete into UPDATE revoked_at, only for live sessions', async () => {
    const { inner, adapter } = fake();
    await adapter.delete({ model: 'session', where: [token] });
    expect(inner.delete).not.toHaveBeenCalled();
    expect(inner.updateMany).toHaveBeenCalledWith({
      model: 'session',
      where: [token, LIVE],
      update: { revokedAt: AT, updatedAt: AT },
    });
  });

  it('turns deleteMany into the same UPDATE and returns how many sessions it revoked', async () => {
    const { inner, adapter } = fake();
    expect(await adapter.deleteMany({ model: 'session', where: [token] })).toBe(2);
    expect(inner.deleteMany).not.toHaveBeenCalled();
  });

  it('leaves out revoked sessions when reading (findOne, findMany, count), with or without a where', async () => {
    const { inner, adapter } = fake();
    await adapter.findOne({ model: 'session', where: [token] });
    await adapter.findMany({ model: 'session' });
    await adapter.count({ model: 'session', where: [token] });
    expect(inner.findOne).toHaveBeenCalledWith({ model: 'session', where: [token, LIVE] });
    expect(inner.findMany).toHaveBeenCalledWith({ model: 'session', where: [LIVE] });
    expect(inner.count).toHaveBeenCalledWith({ model: 'session', where: [token, LIVE] });
  });

  it('refuses consumeOne on a session instead of deleting it', () => {
    const { adapter, inner } = fake();
    expect(() => adapter.consumeOne({ model: 'session', where: [token] })).toThrow(/not supported/);
    expect(inner.consumeOne).not.toHaveBeenCalled();
  });

  it('revokes inside a transaction too', async () => {
    const { adapter, inner } = fake();
    await adapter.transaction((trx) => trx.delete({ model: 'session', where: [token] }));
    expect(inner.delete).not.toHaveBeenCalled();
    expect(inner.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('revokingAdapter: every other model is untouched', () => {
  it('passes reads, writes and deletes of other models straight through', async () => {
    const { inner, adapter } = fake();
    const where = [token];
    await adapter.findOne({ model: 'user', where });
    await adapter.findMany({ model: 'account', where });
    await adapter.count({ model: 'verification' });
    await adapter.delete({ model: 'verification', where });
    await adapter.deleteMany({ model: 'verification', where });
    await adapter.consumeOne({ model: 'verification', where });
    await adapter.create({ model: 'session', data: { token: 't' } });
    await adapter.update({ model: 'session', where, update: { updatedAt: AT } });
    expect(inner.findOne).toHaveBeenCalledWith({ model: 'user', where });
    expect(inner.findMany).toHaveBeenCalledWith({ model: 'account', where });
    expect(inner.count).toHaveBeenCalledWith({ model: 'verification', where: undefined });
    expect(inner.delete).toHaveBeenCalledWith({ model: 'verification', where });
    expect(inner.deleteMany).toHaveBeenCalledWith({ model: 'verification', where });
    expect(inner.consumeOne).toHaveBeenCalledWith({ model: 'verification', where });
    expect(inner.create).toHaveBeenCalledTimes(1);
    expect(inner.update).toHaveBeenCalledTimes(1);
    expect(inner.updateMany).not.toHaveBeenCalled();
  });
});
