import { describe, expect, it } from 'vitest';

import { busyText, teamStatusPath } from './team-status';

describe('team status (U85)', () => {
  it('reads the team by its id', () => {
    expect(teamStatusPath('0190e000-0000-7000-8000-0000000000b1')).toBe(
      '/v1/teams/0190e000-0000-7000-8000-0000000000b1/agent-status',
    );
  });

  it('says the minutes busy today in minutes, then hours', () => {
    expect(busyText(0)).toBe('0 phút');
    expect(busyText(45)).toBe('45 phút');
    expect(busyText(60)).toBe('1 giờ');
    expect(busyText(125)).toBe('2 giờ 5 phút');
  });
});
