import type { LeadEventRow, LeadRow } from '@gani/db';
import { describe, expect, it } from 'vitest';

import { leadEventView, leadView } from './leads.view.js';

const ID = '01900000-0000-7000-8000-000000000001';
const at = new Date('2026-11-05T08:00:00Z');
const row: LeadRow = {
  id: ID,
  workspaceId: ID,
  title: 'Báo giá',
  customerId: ID,
  customerDisplayName: null,
  conversationId: null,
  stageId: ID,
  stageName: 'Bước 1',
  status: 'open',
  ownerUserId: null,
  ownerName: null,
  createdBy: ID,
  lostReason: null,
  closedAt: null,
  version: 0,
  createdAt: at,
  updatedAt: at,
};

describe('leadView', () => {
  it('answers an open lead nobody follows with null owner and closedAt, and score null (Đợt 2)', () => {
    expect(leadView(row)).toMatchObject({
      customer: { id: ID, displayName: null },
      stage: { id: ID, name: 'Bước 1' },
      owner: null,
      closedAt: null,
      score: null,
      createdAt: '2026-11-05T08:00:00.000Z',
    });
  });

  it('answers a lost lead with its owner, reason and closing time', () => {
    const lost = {
      ...row,
      status: 'lost' as const,
      ownerUserId: ID,
      ownerName: null,
      lostReason: 'Giá cao',
      closedAt: at,
    };
    expect(leadView(lost)).toMatchObject({
      owner: { id: ID, name: null },
      lostReason: 'Giá cao',
      closedAt: '2026-11-05T08:00:00.000Z',
    });
  });
});

describe('leadEventView', () => {
  it('answers codes, steps and ids only', () => {
    const e: LeadEventRow = {
      type: 'closed',
      fromStage: null,
      toStage: null,
      outcome: 'won',
      actorUserId: ID,
      occurredAt: at,
    };
    expect(leadEventView(e)).toEqual({ ...e, occurredAt: '2026-11-05T08:00:00.000Z' });
  });
});
