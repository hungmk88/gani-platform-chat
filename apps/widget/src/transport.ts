// How the widget talks to the platform. The widget API (`/v1/widget/sessions`, `/v1/widget/messages`, Brief P9, S10) is not in the
// OpenAPI yet, so W2 runs on `demoTransport`: in the browser only, no network, a canned answer from staff (CEO 26/10: "dùng mock data
// trước"). The real transport replaces it when the API exists; the screen only knows this interface.
import type { Message, PreChat } from './chat';

export interface Transport {
  /** Opens the conversation with what the pre-chat form gave. */
  start(info: PreChat): Promise<void>;
  /** Sends one message with its Idempotency-Key; throws to be tried again (`RetryLater` for a 429). */
  send(text: string, key: string): Promise<Message>;
  /** Calls back for each message from staff. */
  onMessage(listener: (m: Message) => void): void;
  /** "Kết thúc & xóa trên máy này": ends the session and forgets it on this device. */
  end(): Promise<void>;
}

const DEMO_ANSWER = 'Cảm ơn bạn đã nhắn. Nhân viên sẽ trả lời trong ít phút.';

/** The demo of W2 (no API): every message goes through; the first one gets one answer from staff. */
export function demoTransport(delay = 400): Transport {
  let listener: ((m: Message) => void) | null = null;
  let answered = false;
  const later = <T>(value: T) => new Promise<T>((ok) => setTimeout(() => ok(value), delay));
  return {
    start: () => later(undefined),
    async send(text, key) {
      const sent = await later<Message>({ id: key, from: 'customer', text, status: 'sent', key });
      if (!answered) {
        answered = true;
        void later<Message>({
          id: `staff-${key}`,
          from: 'staff',
          text: DEMO_ANSWER,
          status: 'sent',
        }).then((m) => listener?.(m));
      }
      return sent;
    },
    onMessage(l) {
      listener = l;
    },
    end: () => later(undefined),
  };
}
