// loader.js (< 5KB gzip): the script a website embeds, `<script async src=".../loader.js" data-brand-name=…>`. It draws the
// chat button in a Shadow DOM at once and loads the main bundle (widget.js, next to it) on the first click, or 2 seconds
// after the page's `load` (setTimeout, not requestIdleCallback: Safari has none). It reads no cookie or data of the page.
import { brandOf, type Brand } from './brand';
import { css } from './styles';

interface Widget {
  mount(root: ShadowRoot, brand: Brand, open: boolean): void;
}

function start(script: HTMLScriptElement): void {
  const brand = brandOf(script.dataset);
  const host = document.createElement('div');
  host.setAttribute('data-gani-widget', '');
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css(brand.color);
  const box = document.createElement('div');
  box.className = 'root';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'launcher';
  button.textContent = 'Chat';
  button.setAttribute('aria-label', `Mở khung chat với ${brand.name}`);
  box.append(button);
  root.append(style, box);
  document.body.append(host);

  const url = new URL('widget.js', script.src).href;
  let loading: Promise<Widget> | null = null;
  // A failed load is forgotten, so the next click tries again.
  const load = (): Promise<Widget> =>
    (loading ??= (import(/* @vite-ignore */ url) as Promise<Widget>).catch((e: unknown) => {
      loading = null;
      throw e;
    }));
  // A click while the bundle is still coming (after `load`) opens the window once it is there.
  let open = false;
  let mounted = false;
  const mount = () =>
    load().then((w) => {
      if (mounted) return;
      mounted = true;
      w.mount(root, brand, open);
    });
  button.addEventListener('click', () => {
    open = true;
    button.setAttribute('aria-busy', 'true');
    mount().catch(() => button.removeAttribute('aria-busy'));
  });
  const later = () => {
    setTimeout(() => void mount().catch(() => undefined), 2000);
  };
  if (document.readyState === 'complete') later();
  else window.addEventListener('load', later, { once: true });
}

const script = document.currentScript;
if (script instanceof HTMLScriptElement) {
  // An async script can run before <body> exists.
  if (document.body) start(script);
  else document.addEventListener('DOMContentLoaded', () => start(script), { once: true });
}
