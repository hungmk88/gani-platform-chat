import type { BetterAuthOptions } from 'better-auth';
import type { AdapterFactory, DBAdapter, DBTransactionAdapter, Where } from 'better-auth/adapters';

// Better Auth ends a session by DELETE; auth_role has no DELETE and a session is revoked, not removed (ADR-003, N79).
// A delete of a session becomes UPDATE revoked_at and reads leave revoked ones out (Better Auth does not know revoked_at and would
// treat them as valid); other models pass through. It relies on better-auth's adapter interface: re-run the integration test on upgrade.

const SESSION = 'session';
const LIVE: Where = { field: 'revokedAt', value: null, operator: 'eq' };

const live = (model: string, where: Where[] | undefined): Where[] | undefined =>
  model === SESSION ? [...(where ?? []), LIVE] : where;

function wrap<O extends BetterAuthOptions>(
  inner: DBTransactionAdapter<O>,
  now: () => Date,
): DBTransactionAdapter<O> {
  const revoke = (model: string, where: Where[]): Promise<number> => {
    const at = now();
    return inner.updateMany({
      model,
      where: [...where, LIVE],
      update: { revokedAt: at, updatedAt: at },
    });
  };
  return {
    ...inner,
    findOne: (data) =>
      inner.findOne({ ...data, where: live(data.model, data.where) ?? data.where }),
    findMany: (data) => inner.findMany({ ...data, where: live(data.model, data.where) }),
    count: (data) => inner.count({ ...data, where: live(data.model, data.where) }),
    delete: async (data) => {
      if (data.model !== SESSION) return inner.delete(data);
      await revoke(data.model, data.where);
    },
    deleteMany: (data) =>
      data.model === SESSION ? revoke(data.model, data.where) : inner.deleteMany(data),
    // Only verifications are consumed today; fail loudly if that changes instead of deleting a session.
    consumeOne: (data) => {
      if (data.model === SESSION)
        throw new Error('revoking adapter: consumeOne on a session is not supported');
      return inner.consumeOne(data);
    },
  };
}

/** Wraps an adapter factory (for example `drizzleAdapter(...)`). `now` is injectable for tests. */
export function revokingAdapter<Options extends BetterAuthOptions>(
  factory: AdapterFactory<Options>,
  now: () => Date = () => new Date(),
): AdapterFactory<Options> {
  return (options) => {
    const inner: DBAdapter<Options> = factory(options);
    const wrapped = wrap(inner, now);
    return {
      ...wrapped,
      transaction: (callback) => inner.transaction((trx) => callback(wrap(trx, now))),
    };
  };
}
