// The form before the chat (apps/widget/CLAUDE.md "Hành vi bắt buộc"): name, phone (optional), one line on how the data is used with
// the company's policy, and "Đồng ý nhận tin ưu đãi" never ticked by default; chatting does not need it. The wording of the data line
// waits for the lawyer's written answer (U24 (b)); the fields wait for the wireframe of the widget (01/03/2027).
import { useEffect, useRef, useState } from 'preact/hooks';

import type { Brand } from './brand';
import { MAX_NAME, preChatProblem, type PreChat } from './chat';

export function PreChatForm({
  brand,
  busy,
  onStart,
}: {
  brand: Brand;
  busy: boolean;
  onStart: (p: PreChat) => void;
}) {
  const [form, setForm] = useState<PreChat>({ name: '', phone: '', marketing: false });
  const [problem, setProblem] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const edit = (next: Partial<PreChat>) => {
    setForm((f) => ({ ...f, ...next }));
    setProblem(null);
  };
  return (
    <form
      class="prechat"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        const why = preChatProblem(form);
        if (why) return setProblem(why);
        onStart({ ...form, name: form.name.trim(), phone: form.phone.trim() });
      }}
    >
      <label>
        Tên của bạn
        <input
          ref={first}
          value={form.name}
          maxLength={MAX_NAME}
          autoComplete="name"
          onInput={(e) => edit({ name: e.currentTarget.value })}
        />
      </label>
      <label>
        Số điện thoại (không bắt buộc)
        <input
          type="tel"
          inputMode="tel"
          value={form.phone}
          maxLength={20}
          autoComplete="tel"
          onInput={(e) => edit({ phone: e.currentTarget.value })}
        />
      </label>
      <label class="check">
        <input
          type="checkbox"
          checked={form.marketing}
          onChange={(e) => edit({ marketing: e.currentTarget.checked })}
        />
        Đồng ý nhận tin ưu đãi
      </label>
      <p class="small">
        {brand.name} dùng thông tin này để trả lời bạn.{' '}
        {brand.policyUrl ? (
          <a href={brand.policyUrl} target="_blank" rel="noopener noreferrer">
            Chính sách xử lý dữ liệu
          </a>
        ) : null}
      </p>
      {problem ? <p role="alert">{problem}</p> : null}
      <button type="submit" class="primary" disabled={busy} aria-busy={busy}>
        {busy ? 'Đang mở…' : 'Bắt đầu chat'}
      </button>
    </form>
  );
}
