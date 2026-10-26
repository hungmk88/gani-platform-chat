'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { isStrongPassword, MISMATCH, tokenOf, WEAK } from './invite';
import { INVALID, INVALID_HELP, readReset, UNAVAILABLE, type Reset } from './password-reset';

const input = 'rounded-input border border-border-strong bg-surface px-3 py-2';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';
const field = (data: FormData, name: string) => {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
};

type View =
  { name: 'loading' } | { name: 'form'; token: string } | { name: 'invalid' } | { name: 'done' };

/**
 * "Đặt lại mật khẩu" (N162): the link's token, then a new password checked like the API (ADR-003). Done, every session of the person
 * is over and none is made: they sign in again, with their second factor.
 */
export function ResetForm() {
  const [view, setView] = useState<View>({ name: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = tokenOf(window.location.hash);
    // The token stays in memory only: out of the address bar, the history and whatever the person shares of the screen.
    window.history.replaceState(null, '', window.location.pathname);
    // Nothing to ask the API before the form (a refused token is only known when it is spent): the view comes after this render.
    void Promise.resolve<View>(token ? { name: 'form', token } : { name: 'invalid' }).then(setView);
  }, []);

  if (view.name === 'loading') return <p aria-busy="true">Đang mở link…</p>;
  if (view.name === 'invalid')
    return (
      <>
        <h1 className="text-20 font-semibold">{INVALID}</h1>
        <p className="text-text-muted">{INVALID_HELP}</p>
        <Link className={`${primary} self-start`} href="/forgot-password">
          Xin link mới
        </Link>
      </>
    );
  if (view.name === 'done')
    return (
      <>
        <h1 className="text-20 font-semibold">Đã đặt mật khẩu mới</h1>
        <p role="status">
          Mọi thiết bị đang đăng nhập bằng tài khoản này đã bị đăng xuất. Đăng nhập lại bằng mật
          khẩu mới.
        </p>
        <Link className={`${primary} self-start`} href="/login">
          Đến trang đăng nhập
        </Link>
      </>
    );

  const { token } = view;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const password = field(data, 'password');
    if (!isStrongPassword(password)) return setError(WEAK);
    if (password !== field(data, 'again')) return setError(MISMATCH);
    setBusy(true);
    setError(null);
    const res = await fetch('/api/auth/password/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, password }),
    }).catch(() => undefined);
    const result: Reset = res ? await readReset(res) : { kind: 'error', message: UNAVAILABLE };
    setBusy(false);
    if (result.kind === 'ok') setView({ name: 'done' });
    else if (result.kind === 'invalid') setView({ name: 'invalid' });
    else setError(result.kind === 'weak' ? WEAK : result.message);
  }

  return (
    <>
      <h1 className="text-20 font-semibold">Đặt mật khẩu mới</h1>
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
        <label className="flex flex-col gap-1">
          Mật khẩu mới (ít nhất 12 ký tự, có chữ và số)
          <input
            className={input}
            name="password"
            type="password"
            autoComplete="new-password"
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          Nhập lại mật khẩu
          <input
            className={input}
            name="again"
            type="password"
            autoComplete="new-password"
            required
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" className={primary} disabled={busy} aria-busy={busy}>
          {busy ? 'Đang lưu…' : 'Đặt mật khẩu mới'}
        </button>
      </form>
    </>
  );
}
