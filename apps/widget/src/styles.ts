// The stylesheet inside the Shadow DOM: the page's CSS does not reach in (`:host { all: initial }`), ours does not leak out.
// System font, 16px text, sizes 12/14/16/20 only (apps/widget/CLAUDE.md "Thương hiệu"); the brand colour is `--brand`.
export const css = (brand: string): string => `
:host { all: initial; }
.root { --brand: ${brand}; position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
  display: flex; flex-direction: column; align-items: flex-end; gap: 12px;
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #111827; }
button { font: inherit; cursor: pointer; }
button:focus-visible { outline: 2px solid #111827; outline-offset: 2px; }
.launcher { min-width: 56px; min-height: 56px; padding: 0 20px; border: 0; border-radius: 28px;
  background: var(--brand); color: #ffffff; font-size: 16px; box-shadow: 0 4px 12px rgb(0 0 0 / 0.2); }
.window { width: 360px; max-width: calc(100vw - 32px); height: 520px; max-height: calc(100vh - 104px);
  display: flex; flex-direction: column; overflow: hidden; border-radius: 12px; background: #ffffff;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.2); }
.head { display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: var(--brand); color: #ffffff; }
.logo { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 16px;
  background: rgb(255 255 255 / 0.2); font-size: 14px; }
.head h2 { flex: 1; margin: 0; font-size: 16px; font-weight: 600; }
.head button { padding: 4px 8px; border: 0; border-radius: 4px; background: transparent; color: #ffffff; font-size: 14px; }
.head button:focus-visible { outline-color: #ffffff; }
.body { flex: 1; overflow-y: auto; padding: 16px; }
.greeting { margin: 0; padding: 12px; border-radius: 8px; background: #f3f4f6; white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 480px) {
  .root:has(.window) { inset: 0; gap: 0; }
  .window { width: 100%; max-width: none; height: 100%; max-height: none; border-radius: 0; }
  .root:has(.window) .launcher { display: none; }
}
`;
