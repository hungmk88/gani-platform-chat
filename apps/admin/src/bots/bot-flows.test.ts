import { describe, expect, it } from 'vitest';

import {
  draftText,
  flowPath,
  flowsPath,
  publishedText,
  sizeText,
  STATUS,
  type BotFlowDetail,
} from './bot-flows';

type Graph = BotFlowDetail['draft']['graph'];
const version = (graph: Graph) => ({
  id: 'v',
  status: 'draft' as const,
  version: null,
  publishedAt: null,
  graph,
});
const GRAPH: Graph = {
  nodes: [
    { key: 'a', type: 'trigger', config: { on: 'keyword', keywords: ['giá'] } },
    { key: 'b', type: 'question', config: { text: 'SĐT?', kind: 'phone', variable: 'phone' } },
  ],
  edges: [{ from: 'a', to: 'b', label: null }],
};

describe('Bot flows, read only (#17, CEO 01/11)', () => {
  it('asks the flows of one workspace and one flow by its id', () => {
    expect(flowsPath('ws 1')).toBe('/v1/bot-flows?workspaceId=ws+1');
    expect(flowPath('a/b')).toBe('/v1/bot-flows/a%2Fb');
  });

  it('says each state and what was published in words', () => {
    expect(Object.values(STATUS).map(([label]) => label)).toEqual([
      'Nháp, chưa xuất bản',
      'Đang chạy',
      'Tạm dừng',
    ]);
    expect([publishedText(null), publishedText(3)]).toEqual(['Chưa xuất bản', 'Phiên bản 3']);
    expect(sizeText(GRAPH)).toBe('2 bước, 1 đường nối');
  });

  it('says what the draft holds against the version published last, whatever order the API writes', () => {
    const empty = version({ nodes: [], edges: [] });
    expect(draftText({ draft: empty, published: null })).toBe('Bản nháp trống: chưa có bước nào.');
    expect(draftText({ draft: version(GRAPH), published: null })).toBe('Chưa xuất bản lần nào.');
    // The same graph, nodes, edges and config keys in another order: no change.
    const shuffled: Graph = {
      nodes: [
        { key: 'b', type: 'question', config: { variable: 'phone', kind: 'phone', text: 'SĐT?' } },
        { key: 'a', type: 'trigger', config: { keywords: ['giá'], on: 'keyword' } },
      ],
      edges: [...GRAPH.edges],
    };
    expect(draftText({ draft: version(shuffled), published: version(GRAPH) })).toBe(
      'Giống bản đã xuất bản.',
    );
    const relabelled: Graph = { ...GRAPH, edges: [{ from: 'a', to: 'b', label: 'Có' }] };
    expect(draftText({ draft: version(relabelled), published: version(GRAPH) })).toBe(
      'Có thay đổi chưa xuất bản.',
    );
    const retyped: Graph = {
      ...GRAPH,
      nodes: [
        GRAPH.nodes[0]!,
        { key: 'b', type: 'question', config: { text: 'SĐT?', kind: 'text', variable: 'phone' } },
      ],
    };
    expect(draftText({ draft: version(retyped), published: version(GRAPH) })).toBe(
      'Có thay đổi chưa xuất bản.',
    );
  });
});
