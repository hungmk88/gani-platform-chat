// The conversation (W2): the messages as plain text, newest at the bottom, read out by screen readers as they come (aria-live);
// a message being sent says so, one that could not go after 5 tries can be sent again with the same Idempotency-Key.
import { useEffect, useRef, useState } from 'preact/hooks';

import { MAX_TEXT, type Message } from './chat';

const STATUS: Readonly<Record<Message['status'], string | null>> = {
  sending: 'Đang gửi…',
  sent: null,
  failed: 'Chưa gửi được.',
};

export function Conversation({
  messages,
  onSend,
  onRetry,
}: {
  messages: readonly Message[];
  onSend: (text: string) => void;
  onRetry: (m: Message) => void;
}) {
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => box.current?.focus(), []);
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [messages.length]);
  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  };
  return (
    <div class="conversation">
      <ol class="messages" aria-live="polite" aria-label="Tin nhắn">
        {messages.map((m) => (
          <li key={m.id} class={`message ${m.from}`}>
            <span class="sr-only">{m.from === 'customer' ? 'Bạn: ' : 'Nhân viên: '}</span>
            <p>{m.text}</p>
            {STATUS[m.status] ? (
              <span class="small">
                {STATUS[m.status]}
                {m.status === 'failed' ? (
                  <button type="button" class="link" onClick={() => onRetry(m)}>
                    Gửi lại
                  </button>
                ) : null}
              </span>
            ) : null}
          </li>
        ))}
        <li ref={end} aria-hidden="true" />
      </ol>
      <form
        class="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label class="sr-only" for="gani-text">
          Tin nhắn
        </label>
        <textarea
          id="gani-text"
          ref={box}
          rows={2}
          value={text}
          maxLength={MAX_TEXT}
          placeholder="Nhập tin nhắn…"
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="submit" class="primary" disabled={!text.trim()}>
          Gửi
        </button>
      </form>
    </div>
  );
}
