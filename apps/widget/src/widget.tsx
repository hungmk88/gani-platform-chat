// widget.js, the main bundle (< 35KB gzip, Preact): takes over the Shadow DOM the loader made: the chat button and the chat
// window with the workspace's brand and greeting, the form before the chat, then the conversation (W2). The chat lives in `App`, so
// folding the window keeps it. Everything shown is plain text (Preact escapes it).
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import type { Brand } from './brand';
import { sendWithRetry, withMessage, type Message, type PreChat, type Rating } from './chat';
import { Conversation } from './conversation';
import { PreChatForm } from './prechat';
import { RatingForm } from './rating';
import { demoTransport, type Transport } from './transport';

const WINDOW_ID = 'gani-chat';

interface Chat {
  /** The form before the chat, the conversation, or the rating once the customer ended it. */
  readonly stage: 'prechat' | 'chat' | 'rating';
  readonly starting: boolean;
  /** The chat was ended and wiped from this device: the form says thank you. */
  readonly thanked: boolean;
  readonly messages: readonly Message[];
  readonly start: (p: PreChat) => void;
  readonly send: (text: string) => void;
  readonly retry: (m: Message) => void;
  readonly end: () => void;
  /** After the rating (null: skipped): rates, ends the session, wipes the messages from this device. */
  readonly finish: (rating: Rating | null) => void;
}

/** A key for one message, the same on every try (randomUUID needs https, which the pages that embed us have). */
const newKey = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** The chat of the widget over a transport: the messages, sending with retries, ending with a rating. */
function useChat(transport: Transport): Chat {
  const [stage, setStage] = useState<Chat['stage']>('prechat');
  const [starting, setStarting] = useState(false);
  const [thanked, setThanked] = useState(false);
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
    stage,
    starting,
    thanked,
    messages,
    start: (p) => {
      setStarting(true);
      setThanked(false);
      transport.start(p).then(
        () => {
          setStage('chat');
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
    end: () => setStage('rating'),
    finish: (rating) => {
      // A rating that does not go through is not worth keeping the customer waiting: the chat ends anyway.
      void (rating ? transport.rate(rating).catch(() => undefined) : Promise.resolve())
        .then(() => transport.end())
        .finally(() => {
          setMessages([]);
          setStage('prechat');
          setThanked(true);
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
      {chat.stage === 'chat' ? (
        <div class="bar">
          {ending ? (
            <>
              <span>Kết thúc và xóa tin nhắn trên máy này?</span>
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
        {chat.stage === 'chat' ? (
          <Conversation messages={chat.messages} onSend={chat.send} onRetry={chat.retry} />
        ) : chat.stage === 'rating' ? (
          <RatingForm onDone={chat.finish} />
        ) : (
          <>
            {chat.thanked ? (
              <p role="status" class="small">
                Cảm ơn bạn. Tin nhắn đã được xóa khỏi máy này.
              </p>
            ) : null}
            <PreChatForm brand={brand} busy={chat.starting} onStart={chat.start} />
          </>
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
