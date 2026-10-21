'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { readSignIn, UNAVAILABLE, type SignInResult } from './auth';

const input = 'rounded-input border border-border-strong bg-surface px-3 py-2';

/** #1 Đăng nhập (spec M8 §3.8): waits for the server with the button locked; the session cookie is the server's (HttpOnly). */
export function LoginForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await fetch('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: data.get('email'), password: data.get('password') }),
    }).catch(() => undefined);
    const result: SignInResult = res
      ? await readSignIn(res)
      : { kind: 'error', message: UNAVAILABLE };
    if (result.kind === 'ok') {
      router.replace('/');
      router.refresh();
      return;
    }
    if (result.kind === 'two_factor') {
      router.push('/login/two-factor');
      return;
    }
    setBusy(false);
    setError(result.message);
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
      <label className="flex flex-col gap-1">
        Email
        <input className={input} name="email" type="email" autoComplete="username" required />
      </label>
      <label className="flex flex-col gap-1">
        Mật khẩu
        <input
          className={input}
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      {error ? (
        <p role="alert" className="text-error-text">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        aria-busy={busy}
        className="rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70"
      >
        {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
      </button>
    </form>
  );
}
