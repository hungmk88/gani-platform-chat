'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import {
  INVALID,
  INVALID_HELP,
  isStrongPassword,
  MISMATCH,
  needsTwoFactor,
  readAccept,
  readLookup,
  tokenOf,
  UNAVAILABLE,
  WEAK,
  type Accept,
  type Lookup,
} from './invite';

const input = 'rounded-input border border-border-strong bg-surface px-3 py-2';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';
const post = (path: string, body: unknown) =>
  fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => undefined);
const roleName = (role: string) => role.charAt(0).toUpperCase() + role.slice(1);
const field = (data: FormData, name: string) => {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
};

type View =
  | { name: 'loading' }
  | { name: 'invite'; token: string; invitedEmail: string; role: string; signedIn: boolean }
  | { name: 'invalid' }
  | { name: 'error'; message: string };

/** What the link opens: the invitation, the one refusal, or an error; and whether a session is open (it then only joins). */
async function open(token: string | null): Promise<View> {
  if (!token) return { name: 'invalid' };
  const [res, status] = await Promise.all([
    post('/api/auth/invite/lookup', { token }),
    fetch('/v1/me/security-status').catch(() => undefined),
  ]);
  const lookup: Lookup = res ? await readLookup(res) : { kind: 'error', message: UNAVAILABLE };
  if (lookup.kind === 'ok')
    return { name: 'invite', token, ...lookup, signedIn: status?.ok === true };
  return lookup.kind === 'invalid'
    ? { name: 'invalid' }
    : { name: 'error', message: lookup.message };
}

/** #4 Nhận lời mời (N151): one step. A new person sets a password and is signed in; a signed-in person only joins. */
export function InviteForm() {
  const router = useRouter();
  const [view, setView] = useState<View>({ name: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = tokenOf(window.location.hash);
    // The token stays in memory only: out of the address bar, the history and whatever the person shares of the screen.
    window.history.replaceState(null, '', window.location.pathname);
    void open(token).then(setView);
  }, []);

  if (view.name === 'loading') return <p aria-busy="true">Đang mở lời mời…</p>;
  if (view.name === 'invalid')
    return (
      <>
        <h1 className="text-20 font-semibold">{INVALID}</h1>
        <p className="text-text-muted">{INVALID_HELP}</p>
        <Link className={`${primary} self-start`} href="/login">
          Đến trang đăng nhập
        </Link>
      </>
    );
  if (view.name === 'error')
    return (
      <>
        <h1 className="text-20 font-semibold">Chưa mở được lời mời</h1>
        <p role="alert">{view.message}</p>
      </>
    );

  const { token, invitedEmail, role, signedIn } = view;
  async function accept(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const password = field(data, 'password');
    if (!signedIn && !isStrongPassword(password)) return setError(WEAK);
    if (!signedIn && password !== field(data, 'again')) return setError(MISMATCH);
    setBusy(true);
    setError(null);
    const res = await post(
      '/api/auth/invite/accept',
      signedIn ? { token } : { token, password, name: field(data, 'name').trim() },
    );
    const result: Accept = res ? await readAccept(res) : { kind: 'error', message: UNAVAILABLE };
    if (result.kind === 'ok') {
      // The frame decides where to go: the set-up of 2FA for an Owner or Admin (N93), else the page of the role.
      router.replace('/');
      router.refresh();
      return;
    }
    setBusy(false);
    if (result.kind === 'invalid') setView({ name: 'invalid' });
    else setError(result.kind === 'weak' ? WEAK : result.message);
  }

  return (
    <>
      <h1 className="text-20 font-semibold">Bạn được mời tham gia</h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-text-muted">Email được mời</dt>
        <dd>{invitedEmail}</dd>
        <dt className="text-text-muted">Vai trò</dt>
        <dd>{roleName(role)}</dd>
      </dl>
      {needsTwoFactor(role) ? (
        <p className="text-text-muted">
          Vai trò này bắt buộc xác thực 2 lớp: tham gia xong bạn cài 2FA ngay.
        </p>
      ) : null}
      <form className="flex flex-col gap-4" onSubmit={(e) => void accept(e)}>
        {signedIn ? (
          <p>Bạn đang đăng nhập: bấm Tham gia, không cần đặt mật khẩu.</p>
        ) : (
          <>
            <label className="flex flex-col gap-1">
              Họ tên (không bắt buộc)
              <input className={input} name="name" autoComplete="name" maxLength={120} />
            </label>
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
          </>
        )}
        {error ? (
          <p role="alert" className="text-error-text">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy} aria-busy={busy} className={primary}>
          {signedIn ? 'Tham gia' : 'Đặt mật khẩu và tham gia'}
        </button>
      </form>
    </>
  );
}
