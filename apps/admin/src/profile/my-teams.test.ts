import { describe, expect, it } from 'vitest';

import { myTeamsText } from './my-teams';

describe('myTeamsText (U84)', () => {
  it('names each own team with its workspace, or the whole company', () => {
    const workspaces = [{ id: 'w1', name: 'Gani Foods', contactPhone: null }];
    expect(
      myTeamsText({
        workspaces,
        teams: [
          { id: 't1', name: 'CSKH', workspaceId: 'w1' },
          { id: 't2', name: 'Bán sỉ', workspaceId: null },
          { id: 't3', name: 'Cũ', workspaceId: 'w-gone' },
        ],
      }),
    ).toEqual(['CSKH · Gani Foods', 'Bán sỉ · cả công ty', 'Cũ']);
    expect(myTeamsText({ workspaces, teams: [] })).toEqual([]);
  });
});
