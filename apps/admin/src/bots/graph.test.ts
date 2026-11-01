import { describe, expect, it } from 'vitest';

import { configLines, stepsOf, type BotNode } from './graph';

const node = (key: string, n: Partial<BotNode> = {}) =>
  ({ key, type: 'end', config: {}, ...n }) as BotNode;
const edge = (from: string, to: string, label: string | null = null) => ({ from, to, label });

describe('the steps of a bot graph, read only (#17 B, CEO 01/11)', () => {
  it('reads from the trigger along the lines, breadth first, each step once; a step no line reaches comes last', () => {
    const steps = stepsOf({
      nodes: [
        node('z-end'),
        node('lost'),
        node('ask', {
          type: 'question',
          config: { text: 'SĐT?', kind: 'phone', variable: 'phone' },
        }),
        node('start', { type: 'trigger', config: { on: 'first_message' } }),
        node('hi', { type: 'message', config: { text: 'Chào' } }),
      ],
      edges: [
        edge('start', 'hi'),
        edge('hi', 'ask', 'Hỏi'),
        edge('hi', 'z-end'),
        edge('ask', 'hi'),
      ],
    });
    expect(steps.map((s) => [s.n, s.node.key, s.reached])).toEqual([
      [1, 'start', true],
      [2, 'hi', true],
      [3, 'ask', true],
      [4, 'z-end', true],
      [5, 'lost', false],
    ]);
    expect(steps[1]!.next).toEqual([edge('hi', 'ask', 'Hỏi'), edge('hi', 'z-end')]);
    expect(stepsOf({ nodes: [], edges: [] })).toEqual([]);
  });

  it('says what a step does in plain words, the machine names as code', () => {
    expect(
      configLines(
        node('t', { type: 'trigger', config: { on: 'keyword', keywords: ['giá', 'sỉ'] } }),
      ),
    ).toEqual([
      ['Khi', 'Từ khóa'],
      ['Từ khóa', 'giá, sỉ'],
    ]);
    expect(
      configLines(
        node('q', {
          type: 'question',
          config: { text: 'Chọn?', kind: 'choice', choices: ['A', 'B'], variable: 'x' },
        }),
      ),
    ).toEqual([
      ['Câu hỏi', 'Chọn?'],
      ['Kiểu trả lời', 'Chọn một'],
      ['Lựa chọn', 'A, B'],
      ['Lưu vào biến', 'x', true],
    ]);
    expect(
      configLines(node('c', { type: 'condition', config: { expression: { eq: ['a', 1] } } })),
    ).toEqual([['Điều kiện', '{"eq":["a",1]}', true]]);
    expect(configLines(node('d', { type: 'delay', config: { seconds: 90 } }))).toEqual([
      ['Thời gian', '90 giây'],
    ]);
    expect(configLines(node('e'))).toEqual([]);
  });
});
