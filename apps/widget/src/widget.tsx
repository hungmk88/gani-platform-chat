// widget.js, the main bundle (< 35KB gzip, Preact): takes over the Shadow DOM the loader made: the chat button and the chat
// window with the workspace's brand and greeting, the form before the chat, then the conversation (W2). The chat lives in `App`, so
// folding the window keeps it. Everything shown is plain text (Preact escapes it).
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import type { Brand } from './brand';
import { sendWithRetry, withMessage, type Message, type PreChat } from './chat';
import { Conversation } from './conversation';
import { PreChatForm } from './prechat';
import { demoTransport, type Transport } from './transport';

const WINDOW_ID = 'gani-chat';

interface Chat {
  readonly started: boolean;
  readonly starting: boolean;
  readonly messages: readonly Message[];
  readonly start: (p: PreChat) => void;
  readonly send: (text: string) => void;
  readonly retry: (m: Message) => void;
  readonly end: () => void;
}

/** A key for one message, the same on every try (randomUUID needs https, which the pages that embed us have). */
const newKey = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** The chat of the widget over a transport: the messages, sending with retries, ending. */
function useChat(transport: Transport): Chat {
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [messages, setMessages] = useState<readonly Message[]>([]);
  useEffect(() => transport.onMessage((m) => setMessages((l) => withMessage(l, m))), [transport]);
  const deliver = (m: Message) => {
    const key = m.key ?? m.id;
    setMessages((l) => withMessage(l, { ...m, status: 'sending' }));
    sendWithRetry((k) => transport.send(m.text, k), key).then(
      () => setMessages((l) => withMessage(l, { ...m, status: 'sent' })),
      () => setMessages((l) => withMessage(l, { ...m, status: 'failed' })),
    );
  };
  return {
    started,
    starting,
    messages,
    start: (p) => {
      setStarting(true);
      transport.start(p).then(
        () => {
          setStarted(true);
          setStarting(false);
        },
        () => setStarting(false),
      );
    },
    send: (text) => {
      const key = newKey();
      deliver({ id: key, from: 'customer', text, status: 'sending', key });
    },
    retry: deliver,
    end: () => {
      void transport.end().finally(() => {
        setMessages([]);
        setStarted(false);
      });
    },
  };
}

function ChatWindow({ brand, chat, onClose }: { brand: Brand; chat: Chat; onClose: () => void }) {
  const [ending, setEnding] = useState(false);
  return (
    <section
      id={WINDOW_ID}
      class="window"
      role="dialog"
      aria-label={`Chat với ${brand.name}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <header class="head">
        <span class="logo" aria-hidden="true">
          {brand.name.charAt(0).toUpperCase()}
        </span>
        <h2>{brand.name}</h2>
        <button type="button" onClick={onClose}>
          Thu gọn
        </button>
      </header>
      {chat.started ? (
        <div class="bar">
          {ending ? (
            <>
              <span>Xóa tin nhắn trên máy này và kết thúc?</span>
              <button
                type="button"
                class="link"
                onClick={() => {
                  setEnding(false);
                  chat.end();
                }}
              >
                Kết thúc
              </button>
              <button type="button" class="link" onClick={() => setEnding(false)}>
                Không
              </button>
            </>
          ) : (
            <button type="button" class="link" onClick={() => setEnding(true)}>
              Kết thúc & xóa trên máy này
            </button>
          )}
        </div>
      ) : null}
      <div class="body">
        <p class="greeting">{brand.greeting}</p>
        {chat.started ? (
          <Conversation messages={chat.messages} onSend={chat.send} onRetry={chat.retry} />
        ) : (
          <PreChatForm brand={brand} busy={chat.starting} onStart={chat.start} />
        )}
      </div>
    </section>
  );
}

function App({ brand, open: initiallyOpen }: { brand: Brand; open: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const transport = useMemo(() => demoTransport(), []);
  const chat = useChat(transport);
  const launcher = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    launcher.current?.focus();
  };
  return (
    <div class="root">
      {open ? <ChatWindow brand={brand} chat={chat} onClose={close} /> : null}
      <button
        ref={launcher}
        type="button"
        class="launcher"
        aria-label={open ? 'Đóng khung chat' : `Mở khung chat với ${brand.name}`}
        aria-expanded={open}
        aria-controls={WINDOW_ID}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {open ? 'Đóng' : 'Chat'}
      </button>
    </div>
  );
}

/** Called by the loader: replaces its plain chat button with the Preact one, the window open when the person clicked. */
export function mount(root: ShadowRoot, brand: Brand, open: boolean): void {
  root.querySelector('.root')?.remove();
  const container = document.createElement('div');
  root.append(container);
  render(<App brand={brand} open={open} />, container);
}
