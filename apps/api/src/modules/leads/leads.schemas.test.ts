import { describe, expect, it } from 'vitest';

import { LeadCloseSchema, LeadCreateSchema, LeadListQuerySchema } from './leads.schemas.js';

// The rules the planned contract of the leads already states (U6, G3, N188), checked before any module is built.
describe('the lead contract', () => {
  it('needs a reason to lose, and only to lose (G3)', () => {
    const ok = (body: unknown) => LeadCloseSchema.safeParse(body).success;
    expect(ok({ version: 0, outcome: 'won' })).toBe(true);
    expect(ok({ version: 0, outcome: 'lost', lostReason: 'Giá cao' })).toBe(true);
    expect(ok({ version: 0, outcome: 'lost' })).toBe(false);
    expect(ok({ version: 0, outcome: 'lost', lostReason: '  ' })).toBe(false);
    expect(ok({ version: 0, outcome: 'won', lostReason: 'Giá cao' })).toBe(false);
    expect(ok({ version: 0, outcome: 'open' })).toBe(false);
  });

  it('makes a lead only of a customer, with no field it does not know', () => {
    const base = {
      workspaceId: '01900000-0000-7000-8000-000000000001',
      customerId: '01900000-0000-7000-8000-000000000002',
      title: ' Quán Bà Tư ',
    };
    expect(LeadCreateSchema.parse(base).title).toBe('Quán Bà Tư');
    expect(LeadCreateSchema.safeParse({ ...base, customerId: undefined }).success).toBe(false);
    expect(LeadCreateSchema.safeParse({ ...base, status: 'won' }).success).toBe(false);
  });

  it('filters by owner and maker with `me`, and by customer', () => {
    const q = LeadListQuerySchema.parse({
      owner: 'none',
      createdBy: 'me',
      customerId: '01900000-0000-7000-8000-000000000002',
    });
    expect(q).toMatchObject({ owner: 'none', createdBy: 'me', limit: 50 });
    expect(LeadListQuerySchema.safeParse({ createdBy: 'none' }).success).toBe(false);
  });
});
