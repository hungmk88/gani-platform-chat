// widget.js, the main bundle (< 35KB gzip, Preact): takes over the Shadow DOM the loader made. W1: the chat button and the
// chat window with the workspace's brand and greeting; the pre-chat form, the conversation and the rating come in W2.
// Everything shown is plain text (Preact escapes it).
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import type { Brand } from './brand';

const WINDOW_ID = 'gani-chat';

function ChatWindow({ brand, onClose }: { brand: Brand; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);
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
        <button ref={close} type="button" onClick={onClose}>
          Thu gọn
        </button>
      </header>
      <div class="body">
        <p class="greeting">{brand.greeting}</p>
      </div>
    </section>
  );
}

function App({ brand, open: initiallyOpen }: { brand: Brand; open: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const launcher = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    launcher.current?.focus();
  };
  return (
    <div class="root">
      {open ? <ChatWindow brand={brand} onClose={close} /> : null}
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
