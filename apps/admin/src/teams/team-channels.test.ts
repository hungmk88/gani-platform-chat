import { describe, expect, it } from 'vitest';

import { errorOf } from '../api/errors';
import {
  answeredBy,
  channelsOf,
  channelsPath,
  sameChannels,
  teamChannelsError,
  teamChannelsPath,
  withAssigned,
  type Channel,
} from './team-channels';
import type { Team } from './teams';

const channel = (id: string, teamId: string | null): Channel => ({
  id,
  type: 'zalo_oa',
  displayName: `Kênh ${id}`,
  status: 'connected',
  teamId,
});

const team = (id: string, name: string): Team => ({
  id,
  workspaceId: 'w1',
  name,
  slug: name.toLowerCase(),
  description: null,
  isDefault: false,
  memberCount: 0,
  createdAt: '2026-10-25T00:00:00.000Z',
});

describe('paths', () => {
  it('asks the channels of one workspace and names the team', () => {
    expect(channelsPath('w 1')).toBe('/v1/channels?workspaceId=w+1');
    expect(teamChannelsPath('t/1')).toBe('/v1/teams/t%2F1/channels');
  });
});

describe('channelsOf and sameChannels', () => {
  it('compares the picked ids with the channels the team answers, in any order', () => {
    const list = [channel('c1', 't1'), channel('c2', null), channel('c3', 't1')];
    expect([...channelsOf(list, 't1')]).toEqual(['c1', 'c3']);
    expect(sameChannels(new Set(['c3', 'c1']), list, 't1')).toBe(true);
    expect(sameChannels(new Set(['c1']), list, 't1')).toBe(false);
    expect(sameChannels(new Set(['c1', 'c2', 'c3']), list, 't1')).toBe(false);
  });
});

describe('answeredBy', () => {
  it('says another team by name, or the default team; nothing for this team', () => {
    const teams = [team('t1', 'CSKH'), team('t2', 'Sales')];
    expect(answeredBy(channel('c1', 't1'), 't1', teams)).toBeNull();
    expect(answeredBy(channel('c1', null), 't1', teams)).toBe('team mặc định');
    expect(answeredBy(channel('c1', 't2'), 't1', teams)).toBe('Sales');
    expect(answeredBy(channel('c1', 't9'), 't1', teams)).toBe('team khác');
  });
});

describe('withAssigned and teamChannelsError', () => {
  it('gives the picked to the team and sends the others it had back to the default team', () => {
    const list = {
      data: [channel('c1', 't1'), channel('c2', 't2'), channel('c3', null), channel('c4', 't2')],
    };
    expect(withAssigned(list, 't1', ['c2', 'c3'])?.data.map((c) => c.teamId)).toEqual([
      null,
      't1',
      't1',
      't2',
    ]);
    expect(withAssigned(undefined, 't1', [])).toBeUndefined();
  });

  it('says a channel gone, a refusal and a team gone in words of the screen', () => {
    expect(teamChannelsError(errorOf(400, { code: 'validation_failed' }))).toMatch(/kênh/);
    expect(teamChannelsError(errorOf(403, { code: 'forbidden' }))).toMatch(/Owner hoặc Admin/);
    expect(teamChannelsError(errorOf(404, { code: 'not_found' }))).toMatch(/Không tìm thấy/);
    expect(teamChannelsError(errorOf(503, {}))).toBe(errorOf(503, {}).message);
  });
});
