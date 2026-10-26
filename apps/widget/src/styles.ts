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
.body { display: flex; flex-direction: column; gap: 12px; }
.greeting { margin: 0; padding: 12px; border-radius: 8px; background: #f3f4f6; white-space: pre-wrap; overflow-wrap: anywhere; }
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 16px; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
.small { font-size: 14px; color: #4b5563; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.link { padding: 0 4px; border: 0; background: transparent; color: #1d4ed8; text-decoration: underline; font-size: 14px; }
a { color: #1d4ed8; }
.primary { padding: 8px 16px; border: 0; border-radius: 8px; background: var(--brand); color: #ffffff; }
.primary:disabled { opacity: 0.7; cursor: default; }
.prechat { display: flex; flex-direction: column; gap: 12px; }
.prechat label { display: flex; flex-direction: column; gap: 4px; }
.prechat label.check { flex-direction: row; align-items: center; gap: 8px; }
input, textarea { font: inherit; color: inherit; padding: 8px; border: 1px solid #6b7280; border-radius: 4px; background: #ffffff; }
textarea { resize: none; }
::placeholder { color: #6b7280; }
.conversation { flex: 1; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.messages { flex: 1; display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.message { max-width: 80%; padding: 8px 12px; border-radius: 12px; }
.message p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.message.customer { align-self: flex-end; background: var(--brand); color: #ffffff; }
.message.customer .small, .message.customer .link { color: #ffffff; }
.message.staff { align-self: flex-start; background: #f3f4f6; }
.composer { display: flex; gap: 8px; align-items: flex-end; }
.composer textarea { flex: 1; }
@media (max-width: 480px) {
  .root:has(.window) { inset: 0; gap: 0; }
  .window { width: 100%; max-width: none; height: 100%; max-height: none; border-radius: 0; }
  .root:has(.window) .launcher { display: none; }
}
`;
