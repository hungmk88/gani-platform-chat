import { describe, expect, it } from 'vitest';

import { WorkspaceChangeSchema } from './workspaces.schemas.js';

describe('WorkspaceChangeSchema (N157)', () => {
  const ok = (body: unknown) => WorkspaceChangeSchema.safeParse(body).success;

  it('takes an IANA time zone, a trimmed name and a limit of 1..100, at least one of them', () => {
    expect(WorkspaceChangeSchema.parse({ name: '  CSKH ', timezone: 'Asia/Ho_Chi_Minh' })).toEqual({
      name: 'CSKH',
      timezone: 'Asia/Ho_Chi_Minh',
    });
    expect([ok({ timezone: 'UTC' }), ok({ defaultMaxConcurrent: 100 })]).toEqual([true, true]);
  });

  it('refuses nothing to change, an unknown zone or an offset, a blank name, a limit out of range and other fields', () => {
    const bad = [
      {},
      { timezone: 'Mars/Base' },
      { timezone: '+07:00' },
      { name: '  ' },
      { defaultMaxConcurrent: 101 },
      { slug: 'x' },
    ];
    expect(bad.map(ok)).toEqual(bad.map(() => false));
  });
});
