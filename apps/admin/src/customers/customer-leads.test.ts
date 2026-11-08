import { describe, expect, it } from 'vitest';

import { customerLeadsPath } from '../leads/leads';

describe('customerLeadsPath (P3)', () => {
  it('the leads of one customer, every workspace of the session, by cursor', () => {
    expect(customerLeadsPath('c/1', null)).toBe('/v1/leads?customerId=c%2F1&limit=50');
    expect(customerLeadsPath('c1', 'p2')).toBe('/v1/leads?customerId=c1&limit=50&cursor=p2');
  });
});
