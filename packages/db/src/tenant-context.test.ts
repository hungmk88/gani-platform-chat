import { describe, expect, it } from 'vitest';

import {
  TenantContextMissingError,
  currentTenantContext,
  normalizeTenantContext,
  runWithTenantContext,
} from './tenant-context.js';
import { InvalidTenantContextError, assertUuid, toPgUuidArray } from './validate.js';

const A = '018f0000-0000-7000-8000-00000000000a';
const B = '018f0000-0000-7000-8000-00000000000b';
const W1 = '018f0000-0000-7000-8000-0000000000a1';

describe('validate', () => {
  it('accepts UUIDs in any case and lower-cases them', () => {
    expect(assertUuid(A.toUpperCase(), 'orgId')).toBe(A);
  });

  it.each(['', 'not-a-uuid', `${A}'; DROP TABLE x;--`, `{${A}}`, 42, null, undefined])(
    'rejects %j without echoing it',
    (value) => {
      expect(() => assertUuid(value, 'orgId')).toThrow(InvalidTenantContextError);
      expect(() => assertUuid(value, 'orgId')).toThrow(/^tenant context: orgId is not a UUID$/);
    },
  );

  it('builds an array literal, including the empty one', () => {
    expect(toPgUuidArray([A, B])).toBe(`{${A},${B}}`);
    expect(toPgUuidArray([])).toBe('{}');
  });
});

describe('normalizeTenantContext', () => {
  it('drops duplicate workspaces, lower-cases and freezes', () => {
    const ctx = normalizeTenantContext({
      orgId: A.toUpperCase(),
      workspaceIds: [W1, W1.toUpperCase()],
    });
    expect(ctx).toEqual({ orgId: A, workspaceIds: [W1] });
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(Object.isFrozen(ctx.workspaceIds)).toBe(true);
  });

  it('rejects a bad workspace id', () => {
    expect(() => normalizeTenantContext({ orgId: A, workspaceIds: ['x'] })).toThrow(/workspaceId/);
  });
});

describe('current tenant context (AsyncLocalStorage)', () => {
  it('throws outside runWithTenantContext, never returns a default', () => {
    expect(() => currentTenantContext()).toThrow(TenantContextMissingError);
  });

  it('is visible across await and gone afterwards', async () => {
    const seen = await runWithTenantContext({ orgId: A, workspaceIds: [] }, async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
      return currentTenantContext().orgId;
    });
    expect(seen).toBe(A);
    expect(() => currentTenantContext()).toThrow(TenantContextMissingError);
  });

  it('keeps parallel runs apart', async () => {
    const read = (orgId: string, delay: number) =>
      runWithTenantContext({ orgId, workspaceIds: [] }, async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return currentTenantContext().orgId;
      });
    expect(await Promise.all([read(A, 5), read(B, 1)])).toEqual([A, B]);
  });

  it('lets a nested run replace the outer context inside itself only', () => {
    runWithTenantContext({ orgId: A, workspaceIds: [] }, () => {
      runWithTenantContext({ orgId: B, workspaceIds: [] }, () => {
        expect(currentTenantContext().orgId).toBe(B);
      });
      expect(currentTenantContext().orgId).toBe(A);
    });
  });

  it('rejects an invalid context before running fn', () => {
    let ran = false;
    expect(() =>
      runWithTenantContext({ orgId: 'x', workspaceIds: [] }, () => {
        ran = true;
      }),
    ).toThrow(InvalidTenantContextError);
    expect(ran).toBe(false);
  });
});
