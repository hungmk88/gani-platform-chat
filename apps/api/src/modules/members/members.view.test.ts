import type { MemberEntry } from '@gani/db';
import { describe, expect, it } from 'vitest';

import { memberView } from './members.view.js';

const NOW = new Date('2026-10-22T12:00:00Z');
const entry = (over: Partial<MemberEntry>): MemberEntry => ({
  id: '01890000-0000-7000-8000-000000000001',
  userId: '01890000-0000-7000-8000-000000000002',
  email: 'lan@example.test',
  displayName: 'Lan',
  role: 'sales',
  status: 'active',
  twoFactorEnabled: false,
  inviteExpiresAt: null,
  createdAt: NOW,
  ...over,
});

describe('memberView', () => {
  it('shows a member as she is, without the date of the row', () => {
    expect(memberView(entry({}), NOW)).toEqual({
      id: '01890000-0000-7000-8000-000000000001',
      userId: '01890000-0000-7000-8000-000000000002',
      name: 'Lan',
      email: 'lan@example.test',
      role: 'sales',
      status: 'active',
      twoFactorEnabled: false,
      expiresAt: null,
    });
  });

  it('calls an invitation past its date expired, and one still valid pending', () => {
    const at = (iso: string) =>
      memberView(
        entry({
          userId: null,
          displayName: null,
          status: 'pending',
          inviteExpiresAt: new Date(iso),
        }),
        NOW,
      );
    expect(at('2026-10-22T11:59:59Z')).toMatchObject({
      status: 'expired',
      expiresAt: '2026-10-22T11:59:59.000Z',
    });
    expect(at('2026-10-22T12:00:00Z').status).toBe('expired');
    expect(at('2026-10-29T12:00:00Z')).toMatchObject({
      status: 'pending',
      userId: null,
      name: null,
    });
    expect(memberView(entry({ status: 'suspended' }), NOW).status).toBe('suspended');
  });
});
