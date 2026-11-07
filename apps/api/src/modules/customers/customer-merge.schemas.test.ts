import { describe, expect, it } from 'vitest';

import {
  CustomerMergeSchema,
  CustomerMergeSuggestionListSchema,
} from './customer-merge.schemas.js';

// The rules the planned contract of J3 already states (CEO 06/11/2026), checked before the module is built.
const A = '01900000-0000-7000-8000-000000000001';
const B = '01900000-0000-7000-8000-000000000002';

describe('the merge contract', () => {
  it('takes two different customers and nothing else', () => {
    expect(CustomerMergeSchema.safeParse({ sourceId: A, targetId: B }).success).toBe(true);
    expect(CustomerMergeSchema.safeParse({ sourceId: A, targetId: A }).success).toBe(false);
    expect(CustomerMergeSchema.safeParse({ sourceId: A }).success).toBe(false);
    expect(CustomerMergeSchema.safeParse({ sourceId: A, targetId: B, orgId: B }).success).toBe(
      false,
    );
  });

  it('gives each suggestion at least one reason, the same phone or the same email', () => {
    const customer = {
      id: B,
      displayName: null,
      phone: '+84912345678',
      email: null,
      humanOnly: false,
      identities: [],
      tags: [],
      createdAt: '2026-11-07T08:00:00Z',
      updatedAt: '2026-11-07T08:00:00Z',
    };
    const list = (reasons: string[]) => ({ data: [{ customer, reasons }] });
    expect(CustomerMergeSuggestionListSchema.safeParse(list(['phone'])).success).toBe(true);
    expect(CustomerMergeSuggestionListSchema.safeParse(list([])).success).toBe(false);
    expect(CustomerMergeSuggestionListSchema.safeParse(list(['name'])).success).toBe(false);
  });
});
