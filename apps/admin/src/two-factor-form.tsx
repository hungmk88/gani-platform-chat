'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import {
  readVerify,
  UNAVAILABLE,
  VERIFY_PATH,
  type CodeKind,
  type VerifyResult,
} from './two-factor';

const input = 'rounded-input border border-border-strong bg-surface px-3 py-2';

/** #2 verify: 6 digits from the app, or a backup code; the button stays locked until the server answers. */
export function TwoFactorForm() {
  const router = useRouter();
  const [kind, setKind] = useState<CodeKind>('totp');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; restart: boolean } | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = (new FormData(e.currentTarget).get('code') as string | null)?.trim() ?? '';
    setBusy(true);
    setError(null);
    const res = await fetch(VERIFY_PATH[kind], {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    }).catch(() => undefined);
    const result: VerifyResult = res
      ? await readVerify(res, kind)
      : { kind: 'error', message: UNAVAILABLE, restart: false };
    if (result.kind === 'ok') {
      router.replace('/');
      router.refresh();
      return;
    }
    setBusy(false);
    setError(result);
  }

  function switchTo(next: CodeKind) {
    setKind(next);
    setError(null);
  }

  return (
    <form key={kind} className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
      {kind === 'totp' ? (
        <label className="flex flex-col gap-1">
          Mã 6 số trong ứng dụng xác thực
          <input
            className={input}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
          />
        </label>
      ) : (
        <label className="flex flex-col gap-1">
          Mã dự phòng (mỗi mã dùng 1 lần)
          <input className={input} name="code" autoComplete="one-time-code" required />
        </label>
      )}
      {error ? (
        <p role="alert" className="text-error-text">
          {error.message}{' '}
          {error.restart ? (
            <Link href="/login" className="text-accent underline">
              Về trang đăng nhập
            </Link>
          ) : null}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        aria-busy={busy}
        className="rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70"
      >
        {busy ? 'Đang xác thực…' : 'Xác thực'}
      </button>
      <button
        type="button"
        className="text-accent underline"
        onClick={() => switchTo(kind === 'totp' ? 'backup' : 'totp')}
      >
        {kind === 'totp' ? 'Dùng mã dự phòng' : 'Dùng mã 6 số'}
      </button>
      <p className="text-12 text-text-muted">
        Mất điện thoại và hết mã dự phòng: nhờ Owner hoặc Admin đặt lại 2FA ở Cài đặt › Thành viên.
      </p>
    </form>
  );
}
