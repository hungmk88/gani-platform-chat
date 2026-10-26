// #358 "Tạo ticket" from a conversation: a title to start from, taken from what the customer last wrote, which the person edits.
import { inReadingOrder, type Message } from './messages';

export const TITLE_MAX = 80; // fits the Ticket column of the list (#14); the API takes up to 200
export const TITLE_MIN = 10; // "ok", "vâng": shorter than this says nothing, so the field is left empty to be typed

// One segmenter for the module, not one per call. Intl.Segmenter counts what a reader sees as one character: an emoji joined
// by ZWJ (👨‍👩‍👧) or a Vietnamese letter with a combining mark is never cut in two. Every browser the admin targets has it
// (`browserslist` of package.json: Chrome/Edge/Firefox 125+, Safari 17.4+), so there is no other way to count.
const SEGMENTER = new Intl.Segmenter('vi', { granularity: 'grapheme' });
const graphemes = (s: string): string[] => Array.from(SEGMENTER.segment(s), (g) => g.segment);

/** The first line that is not blank, without control characters, its spaces folded; plain text (React escapes it). */
function firstLine(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const clean = line
      .replace(/\p{Cc}/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (clean) return clean;
  }
  return '';
}

/** At most TITLE_MAX characters: cut at the last space before the limit, else at the limit, then "…". */
export function titleOf(body: string): string {
  const chars = graphemes(firstLine(body));
  if (chars.length < TITLE_MIN) return '';
  if (chars.length <= TITLE_MAX) return chars.join('');
  const head = chars.slice(0, TITLE_MAX);
  const space = head.lastIndexOf(' ');
  return `${(space > 0 ? head.slice(0, space) : head).join('').trimEnd()}…`;
}

/**
 * The title from the customer's last text message among the newest page the conversation loaded (50 messages,
 * `messagesPath`). Deliberately no deeper: a customer who wrote only on an older page gives an empty title, not a bug.
 */
export function titleFromMessages(newestPage: readonly Message[]): string {
  const said = inReadingOrder([newestPage]).filter(
    (m) => m.senderKind === 'customer' && m.kind === 'text' && m.body,
  );
  const last = said.at(-1);
  return last?.body ? titleOf(last.body) : '';
}
