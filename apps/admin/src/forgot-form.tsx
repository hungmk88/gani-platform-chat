'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { readForgot, SENT, UNAVAILABLE, type Forgot } from './password-reset';

const input = 'rounded-input border border-border-strong bg-surface px-3 py-2';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';

/** "Quên mật khẩu" (N162): one email, one answer that never says whether the address has an account. */
export function ForgotForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = new FormData(e.currentTarget).get('email');
    setBusy(true);
    setError(null);
    const res = await fetch('/api/auth/password/forgot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: typeof email === 'string' ? email.trim().toLowerCase() : '' }),
    }).catch(() => undefined);
    const result: Forgot = res ? await readForgot(res) : { kind: 'error', message: UNAVAILABLE };
    setBusy(false);
    if (result.kind === 'sent') setSent(true);
    else setError(result.message);
  }

  if (sent)
    return (
      <>
        <p role="status">{SENT}</p>
        <Link className={`${primary} self-start`} href="/login">
          Về trang đăng nhập
        </Link>
      </>
    );
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={(e) => void submit(e)}>
      <label className="flex flex-col gap-1">
        Email đăng nhập
        <input
          className={input}
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" className={primary} disabled={busy} aria-busy={busy}>
        {busy ? 'Đang gửi…' : 'Gửi link đặt lại'}
      </button>
      <Link className="self-start underline" href="/login">
        Về trang đăng nhập
      </Link>
    </form>
  );
}
