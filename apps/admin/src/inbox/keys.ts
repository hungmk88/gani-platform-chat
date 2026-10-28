// Keyboard of the Inbox (#6, prototype inbox.js "Bảng phím tắt"): J/K move between the conversations of the list as loaded, in its
// order; the table says only the keys that work today (A, R, E, T elsewhere; N and / wait for notes and search).

/** The conversation J (+1) or K (−1) opens from `current`: the first (J) or the last (K) when none is open, none past the ends. */
export function neighbour(
  ids: readonly string[],
  current: string | null,
  step: 1 | -1,
): string | null {
  if (ids.length === 0) return null;
  const at = current === null ? -1 : ids.indexOf(current);
  if (at === -1) return step === 1 ? ids[0]! : ids[ids.length - 1]!;
  return ids[at + step] ?? null;
}

/** The id in `/inbox/{id}`, or null on the list alone. */
export const openId = (pathname: string): string | null =>
  /^\/inbox\/([^/?#]+)/.exec(pathname)?.[1] ?? null;

/** The keys that work today, as the table shows them. */
export const SHORTCUTS: readonly (readonly [string, string])[] = [
  ['J / K', 'Hội thoại kế tiếp / trước'],
  ['A', 'Nhận hội thoại'],
  ['R', 'Vào ô trả lời'],
  ['Ctrl/⌘ + Enter', 'Gửi tin trả lời'],
  ['E', 'Đóng hội thoại'],
  ['T', 'Chuyển hội thoại'],
  ['?', 'Bảng phím tắt'],
  ['Esc', 'Đóng hộp thoại'],
];
