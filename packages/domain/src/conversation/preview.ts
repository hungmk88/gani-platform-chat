// The line of the Inbox under a conversation (U30, N169): what its last message said, stored on the conversation when the message is
// written. Only the text of a text message is kept; another kind shows a fixed label chosen when read, so changing a label changes
// no stored row. The text is PII: never logged.

export const PREVIEW_KINDS = ['text', 'image', 'file', 'sticker', 'postback'] as const;
export type PreviewKind = (typeof PREVIEW_KINDS)[number];

/** What the Inbox shows for a last message that is not text. */
export const MESSAGE_KIND_LABEL: Readonly<Record<Exclude<PreviewKind, 'text'>, string>> = {
  image: '[Hình ảnh]',
  file: '[Tệp]',
  sticker: '[Sticker]',
  postback: '[Lựa chọn]',
};

/** How long the stored text may be, in graphemes (what a person sees as one character). */
export const PREVIEW_GRAPHEMES = 120;

const graphemes = new Intl.Segmenter('vi', { granularity: 'grapheme' });

/**
 * The text to store for the last message: NFC, every run of spaces and line breaks made one space, at most `PREVIEW_GRAPHEMES`
 * graphemes so a Vietnamese letter and its marks, or an emoji of several code points, is never cut in two. No `…` is added: the Inbox
 * shows the cut. Null for a message that is not text, or whose text is only spaces.
 */
export function messagePreview(kind: string, body: string | null | undefined): string | null {
  if (kind !== 'text' || !body) return null;
  const flat = body.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (flat === '') return null;
  let out = '';
  let n = 0;
  for (const { segment } of graphemes.segment(flat)) {
    if (n++ === PREVIEW_GRAPHEMES) break;
    out += segment;
  }
  return out.trimEnd();
}

/** What the Inbox shows: the stored text, or the label of the kind; null when the conversation has no message to show yet. */
export function previewOf(kind: string | null, text: string | null): string | null {
  if (kind === null) return null;
  if (kind === 'text') return text;
  return kind in MESSAGE_KIND_LABEL
    ? MESSAGE_KIND_LABEL[kind as keyof typeof MESSAGE_KIND_LABEL]
    : null;
}

/** Whether a message moves the line of the Inbox: everything but the events of the system. */
export const movesPreview = (senderKind: string, kind: string): boolean =>
  senderKind !== 'system' && kind !== 'system';
