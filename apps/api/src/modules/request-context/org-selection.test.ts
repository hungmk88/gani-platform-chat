import type { MemberContext } from '@gani/db';
import { describe, expect, it, vi } from 'vitest';

import { chooseOrganisation, ORGANISATION_REFUSALS } from './org-selection.js';

const member: MemberContext = { role: 'sales', workspaceIds: ['w1'] };

// The sources are fakes: which organisations a person belongs to, and in which of them they are an active member.
function sources(orgs: string[], members: Record<string, MemberContext | null>) {
  return {
    organisations: vi.fn(() => Promise.resolve(orgs)),
    member: vi.fn((orgId: string) => Promise.resolve(members[orgId] ?? null)),
  };
}

describe('chooseOrganisation', () => {
  it('takes the organisation of the session while the person is a member of it, without listing the others', async () => {
    const s = sources(['o1', 'o2'], { o2: member });
    expect(await chooseOrganisation(s, { userId: 'u', activeOrgId: 'o2' })).toEqual({
      orgId: 'o2',
      member,
    });
    expect(s.organisations).not.toHaveBeenCalled();
  });

  it('falls back to the only organisation when the chosen one is no longer theirs, or none was chosen', async () => {
    const s = sources(['o1'], { o1: member });
    expect(await chooseOrganisation(s, { userId: 'u', activeOrgId: 'gone' })).toEqual({
      orgId: 'o1',
      member,
    });
    expect(await chooseOrganisation(s, { userId: 'u', activeOrgId: null })).toEqual({
      orgId: 'o1',
      member,
    });
  });

  it('refuses several organisations without a choice, and none at all', async () => {
    const choose = (orgs: string[], members = {}) =>
      chooseOrganisation(sources(orgs, members), { userId: 'u', activeOrgId: null });
    expect(await choose(['o1', 'o2'], { o1: member, o2: member })).toEqual({
      refused: 'org_not_selected',
    });
    expect(await choose([])).toEqual({ refused: 'no_organisation' });
    // Listed as active, but no longer a member by the time the role is read.
    expect(await choose(['o1'])).toEqual({ refused: 'no_organisation' });
    expect(Object.keys(ORGANISATION_REFUSALS).sort()).toEqual([
      'no_organisation',
      'org_not_selected',
    ]);
  });

  it('lets a database failure through, so it is never answered as a refusal', async () => {
    const s = sources(['o1'], {});
    s.organisations.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(chooseOrganisation(s, { userId: 'u', activeOrgId: null })).rejects.toThrow();
  });
});
