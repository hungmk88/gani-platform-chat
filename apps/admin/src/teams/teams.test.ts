import { describe, expect, it } from 'vitest';

import { errorOf } from '../api/errors';
import { teamDraftOf, teamError, teamsPath, withTeam, type Team } from './teams';

const team = (over: Partial<Team> = {}): Team => ({
  id: 't1',
  workspaceId: 'w1',
  name: 'Sales B2B',
  slug: 'sales-b2b',
  description: null,
  isDefault: false,
  memberCount: 0,
  channelIds: [],
  createdAt: '2026-10-24T00:00:00.000Z',
  ...over,
});

describe('teamsPath', () => {
  it('asks the teams of one workspace', () => {
    expect(teamsPath('w 1')).toBe('/v1/teams?workspaceId=w+1');
  });
});

describe('teamDraftOf', () => {
  it('trims like the API and leaves out a blank description', () => {
    expect(teamDraftOf('w1', '  CSKH ', '  ')).toEqual({ workspaceId: 'w1', name: 'CSKH' });
    expect(teamDraftOf('w1', 'CSKH', ' Sau bán hàng ')).toEqual({
      workspaceId: 'w1',
      name: 'CSKH',
      description: 'Sau bán hàng',
    });
  });

  it('says a missing or long name and a long description', () => {
    expect(teamDraftOf('w1', ' ', '')).toBe('Nhập tên team.');
    expect(teamDraftOf('w1', 'x'.repeat(101), '')).toMatch(/100 ký tự/);
    expect(teamDraftOf('w1', 'CSKH', 'x'.repeat(501))).toMatch(/500 ký tự/);
  });
});

describe('withTeam and teamError', () => {
  it('adds a new team in the order of the names, once', () => {
    const list = { data: [team({ id: 'a', name: 'Bán lẻ' }), team({ id: 'c', name: 'Sales' })] };
    const next = withTeam(list, team({ id: 'b', name: 'CSKH' }));
    expect(next?.data.map((t) => t.name)).toEqual(['Bán lẻ', 'CSKH', 'Sales']);
    expect(withTeam(next, team({ id: 'b', name: 'CSKH' }))).toBe(next);
    expect(withTeam(undefined, team())).toBeUndefined();
  });

  it('says a refusal, a workspace gone and a value refused in words of the screen', () => {
    expect(teamError(errorOf(403, { code: 'forbidden' }))).toMatch(/Owner hoặc Admin/);
    expect(teamError(errorOf(404, { code: 'not_found' }))).toMatch(/Không tìm thấy/);
    expect(teamError(errorOf(400, { code: 'validation_failed' }))).toMatch(/1–100/);
    expect(teamError(errorOf(503, {}))).toBe(errorOf(503, {}).message);
  });
});
