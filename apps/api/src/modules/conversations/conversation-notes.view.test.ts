import { describe, expect, it } from 'vitest';

import { noteView } from './conversation-notes.view.js';

describe('noteView', () => {
  it('gives the author as an object and the time in ISO, nothing else of the row', () => {
    expect(
      noteView({
        id: 'n',
        conversationId: 'c',
        kind: 'transfer_reason',
        authorUserId: 'u',
        authorName: null,
        body: 'Lý do',
        createdAt: new Date('2026-11-04T10:00:00Z'),
      }),
    ).toEqual({
      id: 'n',
      conversationId: 'c',
      kind: 'transfer_reason',
      author: { id: 'u', name: null },
      body: 'Lý do',
      createdAt: '2026-11-04T10:00:00.000Z',
    });
  });
});
