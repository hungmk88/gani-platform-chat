import { describe, expect, it } from 'vitest';

import { columnsOf, leadsPath, pipelinePath, type Lead } from './leads';

const stage = (id: string, position = 0) => ({ id, name: `Tên ${id}`, position });
const lead = (id: string, stageId: string, status: Lead['status'] = 'open'): Lead => ({
  id,
  workspaceId: 'w',
  customer: { id: `c-${id}`, displayName: null },
  conversationId: null,
  title: `Lead ${id}`,
  stage: stage(stageId),
  status,
  owner: null,
  createdBy: 'u',
  lostReason: status === 'lost' ? 'lý do' : null,
  closedAt: null,
  score: null,
  version: 1,
  createdAt: '2026-11-02T00:00:00.000Z',
  updatedAt: '2026-11-02T00:00:00.000Z',
});

describe('the board of #12 Pipeline lead, on the contract of #544 (real API since L4, #616)', () => {
  it('has the steps in the order of the pipeline, then Thắng and Thua, a closed lead in its own column only', () => {
    const cols = columnsOf(
      [stage('b'), stage('a')],
      [
        lead('1', 'a'),
        lead('2', 'b'),
        lead('3', 'a', 'won'),
        lead('4', 'b', 'lost'),
        lead('5', 'a'),
      ],
    );
    expect(cols.map((c) => [c.title, c.leads.map((l) => l.id)])).toEqual([
      ['Tên b', ['2']],
      ['Tên a', ['1', '5']],
      ['Thắng', ['3']],
      ['Thua', ['4']],
    ]);
    expect(columnsOf([], []).map((c) => c.key)).toEqual(['won', 'lost']);
  });

  it('keeps an open lead whose step the pipeline no longer lists, in a column after the steps', () => {
    const cols = columnsOf([stage('a')], [lead('1', 'gone'), lead('2', 'gone', 'won')]);
    expect(cols.map((c) => [c.key, c.leads.length])).toEqual([
      ['a', 0],
      ['unknown', 1],
      ['won', 1],
      ['lost', 0],
    ]);
  });

  it('asks the workspace being worked in, the leads by cursor', () => {
    expect(leadsPath('w 1', null)).toBe('/v1/leads?workspaceId=w+1&limit=100');
    expect(leadsPath('w', '5')).toBe('/v1/leads?workspaceId=w&limit=100&cursor=5');
    expect(pipelinePath('w/1')).toBe('/v1/workspaces/w%2F1/pipeline');
  });
});
