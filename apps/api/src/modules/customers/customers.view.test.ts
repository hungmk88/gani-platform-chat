import { describe, expect, it } from 'vitest';

import { seesCustomersMasked } from './customers.permissions.js';
import { customerView, maskEmail, maskPhone } from './customers.view.js';

const row = {
  id: 'c',
  displayName: 'Lan',
  phoneE164: '+84912345678',
  email: 'lan.nguyen@example.test',
  humanOnly: false,
  identities: [
    { type: 'zalo_uid' as const, channelAccountId: 'a', verification: 'unverified' as const },
  ],
  createdAt: new Date('2026-10-26T00:00:00Z'),
  updatedAt: new Date('2026-10-26T01:00:00Z'),
};

describe('customerView', () => {
  it('masks the phone and the email for Marketing and Viewer only (Phụ lục B "Che")', () => {
    expect(
      (['owner', 'sales', 'support', 'marketing', 'viewer'] as const).map(seesCustomersMasked),
    ).toEqual([false, false, false, true, true]);
    expect(customerView(row, false)).toMatchObject({
      phone: '+84912345678',
      email: 'lan.nguyen@example.test',
    });
    expect(customerView(row, true)).toMatchObject({
      phone: '+8491*****78',
      email: 'l***@example.test',
      createdAt: '2026-10-26T00:00:00.000Z',
    });
    expect(customerView({ ...row, phoneE164: null, email: null }, true)).toMatchObject({
      phone: null,
      email: null,
    });
  });

  it('keeps the network and the last two digits of a number, and hides at least one digit of the shortest', () => {
    expect(maskPhone('+14155550100')).toBe('+1415*****00');
    expect(maskPhone('+8412345')).toBe('+8412*45');
    expect(maskEmail('a@b.test')).toBe('a***@b.test');
  });
});
