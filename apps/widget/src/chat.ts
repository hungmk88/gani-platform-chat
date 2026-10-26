// The chat of the widget without the screen (W2): the pre-chat form, the messages and how a message is sent again
// (apps/widget/CLAUDE.md "Hành vi bắt buộc"): up to 5 tries, waiting longer each time, always with the same Idempotency-Key;
// a 429 waits its Retry-After. Everything shown is plain text.

export interface Message {
  readonly id: string;
  readonly from: 'customer' | 'staff';
  readonly text: string;
  readonly status: 'sending' | 'sent' | 'failed';
  /** The Idempotency-Key of a message the customer wrote: the same on every try, so the API keeps one. */
  readonly key?: string;
}

export interface PreChat {
  readonly name: string;
  readonly phone: string;
  /** "Đồng ý nhận tin ưu đãi": never ticked by default, chatting does not need it. */
  readonly marketing: boolean;
}

/** The rating after the chat (Phụ lục C dòng 10): 1 to 5 stars, a remark if the customer wants. */
export interface Rating {
  readonly stars: 1 | 2 | 3 | 4 | 5;
  readonly remark: string;
}

export const MAX_NAME = 100;
export const MAX_REMARK = 500;
export const MAX_TEXT = 2000;
/** Tries of one message before it shows "Chưa gửi được" (CLAUDE.md: at most 5). */
export const TRIES = 5;

/** A Vietnamese number as people type it: 0 and 9–10 digits, or +84 and 9–10 digits; spaces, dots and dashes allowed. */
const PHONE = /^(0|\+84)[0-9]{9,10}$/;

/** Why the form cannot be sent, or null. The name is needed to answer; the phone is optional (saved as not verified). */
export function preChatProblem(p: PreChat): string | null {
  const name = p.name.trim();
  if (!name) return 'Nhập tên của bạn.';
  if (name.length > MAX_NAME) return `Tên tối đa ${MAX_NAME} ký tự.`;
  const phone = p.phone.replace(/[\s.-]/g, '');
  if (phone && !PHONE.test(phone)) return 'Số điện thoại chưa đúng, ví dụ 0912 345 678.';
  return null;
}

/** A refusal that says when to try again (429 Retry-After, in seconds). */
export class RetryLater extends Error {
  constructor(readonly seconds: number) {
    super('retry_later');
  }
}

/** The wait before try `n` (from 1): 1, 2, 4, 8 seconds; a Retry-After wins. */
export const waitBefore = (n: number, error: unknown): number =>
  error instanceof RetryLater ? error.seconds * 1000 : 1000 * 2 ** (n - 1);

/** Sends with `send(key)` up to TRIES times, the same key each time; throws the last error when every try fails. */
export async function sendWithRetry<T>(
  send: (key: string) => Promise<T>,
  key: string,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((ok) => setTimeout(ok, ms)),
): Promise<T> {
  for (let n = 1; ; n += 1) {
    try {
      return await send(key);
    } catch (error) {
      if (n >= TRIES) throw error;
      await sleep(waitBefore(n, error));
    }
  }
}

/** The list with one message replaced (same id), or added at the end. */
export const withMessage = (list: readonly Message[], m: Message): Message[] =>
  list.some((x) => x.id === m.id) ? list.map((x) => (x.id === m.id ? m : x)) : [...list, m];
