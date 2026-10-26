import { describe, expect, it } from 'vitest';

import { answeringTeam, channelsPath, type Channel } from './channels';

const channel = (teamId: string | null): Channel => ({
  id: 'c1',
  type: 'zalo_oa',
  displayName: 'Zalo OA Gani',
  status: 'connected',
  teamId,
});

describe('channelsPath', () => {
  it('asks the channels of one workspace', () => {
    expect(channelsPath('w 1')).toBe('/v1/channels?workspaceId=w+1');
  });
});

describe('answeringTeam', () => {
  it('names the team, the default one when none is set, nothing while the teams are not known', () => {
    const teams = [{ id: 't1', name: 'CSKH' }];
    expect(answeringTeam(channel('t1'), teams)).toBe('CSKH');
    expect(answeringTeam(channel(null), teams)).toBe('Team mặc định');
    expect(answeringTeam(channel(null), undefined)).toBe('Team mặc định');
    expect(answeringTeam(channel('t2'), teams)).toBe('—');
    expect(answeringTeam(channel('t1'), undefined)).toBe('—');
  });
});
