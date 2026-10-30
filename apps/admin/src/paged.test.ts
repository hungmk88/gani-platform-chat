import { describe, expect, it } from 'vitest';

import { uniqueRows } from './paged';

describe('uniqueRows', () => {
  it('keeps each row once, in the order first read', () => {
    const rows = uniqueRows([
      { data: [{ id: 'a' }, { id: 'b' }] },
      { data: [{ id: 'b' }, { id: 'c' }] },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});
