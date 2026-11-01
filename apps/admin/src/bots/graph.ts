// #17 part B (CEO 01/11): the graph of a version read as a list of steps, no canvas. Reading order: breadth first from the trigger
// along the lines, as the API orders them; a step no line reaches comes last, said so (the API refuses such a graph, botGraphProblem,
// so this is a guard). Labels as the prototype (prototype/dot1/bots.js); "Thu dữ liệu" as the list of features (D1).
import type { components } from '../api/schema';

type BotGraph = components['schemas']['BotGraph'];
export type BotNode = BotGraph['nodes'][number];
type BotEdge = BotGraph['edges'][number];

export const NODE_TYPE: Readonly<Record<BotNode['type'], string>> = {
  trigger: 'Bắt đầu',
  message: 'Gửi tin',
  question: 'Hỏi và chờ trả lời',
  condition: 'Rẽ nhánh',
  set_variable: 'Ghi biến',
  collect: 'Thu dữ liệu',
  tag: 'Gắn tag',
  api_call: 'Gọi tool nội bộ',
  delay: 'Chờ',
  handoff: 'Chuyển người',
  jump_to_flow: 'Chuyển sang flow khác',
  end: 'Kết thúc',
};
const ON = {
  first_message: 'Tin đầu tiên',
  keyword: 'Từ khóa',
  intent: 'Ý định',
  after_hours: 'Ngoài giờ',
};
const KIND = { text: 'Chữ', phone: 'Số điện thoại', number: 'Số', choice: 'Chọn một' };
const PRIORITY = { normal: 'Thường', high: 'Cao', urgent: 'Khẩn' };

export interface Step {
  readonly node: BotNode;
  readonly n: number;
  readonly reached: boolean;
  readonly next: readonly BotEdge[];
}

/** The steps in reading order, each with its number, whether a line reaches it, and the lines leaving it. */
export function stepsOf(g: BotGraph): Step[] {
  const byKey = new Map(g.nodes.map((n) => [n.key, n]));
  const next = new Map<string, BotEdge[]>();
  for (const e of g.edges) next.set(e.from, [...(next.get(e.from) ?? []), e]);
  const order: string[] = [];
  const visit = (key: string) => {
    if (byKey.has(key) && !order.includes(key)) order.push(key);
  };
  g.nodes.filter((n) => n.type === 'trigger').forEach((n) => visit(n.key));
  for (let i = 0; i < order.length; i++) next.get(order[i]!)?.forEach((e) => visit(e.to));
  const reached = order.length;
  g.nodes.forEach((n) => visit(n.key));
  return order.map((key, i) => ({
    node: byKey.get(key)!,
    n: i + 1,
    reached: i < reached,
    next: next.get(key) ?? [],
  }));
}

/** What a step does as [term, plain text, shown as code]; the flow of a jump is drawn by the screen (a link when it is listed). */
export function configLines(node: BotNode): (readonly [string, string, boolean?])[] {
  switch (node.type) {
    case 'trigger': {
      const { on, keywords, intent } = node.config;
      return [
        ['Khi', ON[on]],
        ...(keywords ? [['Từ khóa', keywords.join(', ')] as const] : []),
        ...(intent ? [['Ý định', intent] as const] : []),
      ];
    }
    case 'message':
      return [['Nội dung', node.config.text]];
    case 'question': {
      const { text, kind, choices, variable } = node.config;
      return [
        ['Câu hỏi', text],
        ['Kiểu trả lời', KIND[kind]],
        ...(choices ? [['Lựa chọn', choices.join(', ')] as const] : []),
        ['Lưu vào biến', variable, true],
      ];
    }
    case 'condition':
      return [['Điều kiện', JSON.stringify(node.config.expression), true]];
    case 'set_variable':
      return [['Biến', `${node.config.variable} = ${JSON.stringify(node.config.value)}`, true]];
    case 'collect':
      return [['Trường', node.config.field, true]];
    case 'tag':
      return [['Tag', node.config.tag]];
    case 'api_call':
      return [['Tool', node.config.tool, true]];
    case 'delay':
      return [['Thời gian', `${node.config.seconds} giây`]];
    case 'handoff':
      return [
        ['Lý do', node.config.reason],
        ['Ưu tiên', PRIORITY[node.config.priority]],
      ];
    case 'jump_to_flow':
    case 'end':
      return [];
  }
}
