import { holderOf, type Conversation } from './list';

/** Who holds the conversation (U30, `holderOf`): the same words on the row and on the open conversation, for every role. */
export function Holder({ c, meId }: { c: Conversation; meId: string }) {
  const h = holderOf(c, meId);
  return h.title ? <abbr title={h.title}>{h.text}</abbr> : <>{h.text}</>;
}
