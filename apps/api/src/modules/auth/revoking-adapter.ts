import type { BetterAuthOptions } from 'better-auth';
import type { AdapterFactory, DBAdapter, DBTransactionAdapter, Where } from 'better-auth/adapters';

// Better Auth ends a session and a one-time token by DELETE; auth_role has no DELETE (ADR-003, N79, N87). A delete becomes an UPDATE
// that marks the row (sessions: revoked_at, verifications: used_at) and reads leave marked rows out, because Better Auth does not
// know the marker and would treat them as still valid. Consuming a one-time token is a claim: UPDATE ... WHERE id AND marker IS NULL,
// so of two requests for the same token PostgreSQL lets exactly one update the row. Other models pass through. It relies on the
// adapter interface and the internals of better-auth: re-run the integration tests on every upgrade.
// A soft-deleted person (users.deleted_at, review DB-01) does not exist for Better Auth: reads of `user` leave them out, so signing in
// finds no one, and a session read with its user joined (getSession) is dropped when that user is deleted. A where clause cannot reach
// the joined row, so that one is filtered after the read.

const MARKER = { session: 'revokedAt', verification: 'usedAt' } as const;
const markerOf = (model: string): string | undefined =>
  Object.hasOwn(MARKER, model) ? MARKER[model as keyof typeof MARKER] : undefined;
const unmarked = (field: string): Where => ({ field, value: null, operator: 'eq' });

const live = (model: string, where: Where[] | undefined): Where[] | undefined => {
  const field = model === 'user' ? 'deletedAt' : markerOf(model);
  return field === undefined ? where : [...(where ?? []), unmarked(field)];
};

/** A row read with its user joined (`join: { user: true }`) whose user is soft-deleted. */
const ofDeletedUser = (row: unknown): boolean => {
  const user = (row as { user?: { deletedAt?: unknown } } | null)?.user;
  return user?.deletedAt !== undefined && user.deletedAt !== null;
};

function wrap<O extends BetterAuthOptions>(
  inner: DBTransactionAdapter<O>,
  now: () => Date,
): DBTransactionAdapter<O> {
  // Marks the live rows that match; returns how many.
  const end = (model: string, field: string, where: Where[]): Promise<number> => {
    const at = now();
    return inner.updateMany({
      model,
      where: [...where, unmarked(field)],
      update: { [field]: at, updatedAt: at },
    });
  };
  return {
    ...inner,
    findOne: async <T>(data: Parameters<DBTransactionAdapter<O>['findOne']>[0]) => {
      const row = await inner.findOne<T>({
        ...data,
        where: live(data.model, data.where) ?? data.where,
      });
      return ofDeletedUser(row) ? null : row;
    },
    findMany: async <T>(data: Parameters<DBTransactionAdapter<O>['findMany']>[0]) => {
      const rows = await inner.findMany<T>({ ...data, where: live(data.model, data.where) });
      return rows.filter((row) => !ofDeletedUser(row));
    },
    count: (data) => inner.count({ ...data, where: live(data.model, data.where) }),
    delete: async (data) => {
      const field = markerOf(data.model);
      if (field === undefined) return inner.delete(data);
      await end(data.model, field, data.where);
    },
    deleteMany: (data) => {
      const field = markerOf(data.model);
      return field === undefined ? inner.deleteMany(data) : end(data.model, field, data.where);
    },
    consumeOne: async <T>(data: { model: string; where: Where[] }): Promise<T | null> => {
      if (data.model === 'session') {
        throw new Error('revoking adapter: consumeOne on a session is not supported');
      }
      const field = markerOf(data.model);
      if (field === undefined) return inner.consumeOne<T>(data);
      const row = await inner.findOne<T & { id: string }>({
        model: data.model,
        where: [...data.where, unmarked(field)],
      });
      if (!row) return null;
      const at = now();
      const won = await inner.update({
        model: data.model,
        where: [{ field: 'id', value: row.id }, unmarked(field)],
        update: { [field]: at, updatedAt: at },
      });
      return won ? row : null;
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
