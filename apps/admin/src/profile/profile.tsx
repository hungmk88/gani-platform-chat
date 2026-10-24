'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { ROLE_NAME, type Role } from '../nav';
import { passwordProblem, readChangePassword } from './password';
import { TABS, type Tab } from './tabs';

const input = 'rounded-input border border-border-strong px-3 py-2';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';
const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const post = (path: string, body: object) =>
  fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

function ChangePassword() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const [current, next, again] = ['current', 'next', 'again'].map((k) => {
      const value = data.get(k);
      return typeof value === 'string' ? value : '';
    });
    const others = data.get('others') === 'on';
    const problem = passwordProblem(current ?? '', next ?? '', again ?? '');
    setDone(null);
    setError(problem);
    if (problem) return;
    setBusy(true);
    const res = await post('/api/auth/change-password', {
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: others,
    }).catch(() => null);
    const result = res
      ? await readChangePassword(res)
      : {
          kind: 'error' as const,
          message: 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.',
        };
    setBusy(false);
    if (result.kind === 'signed_out') return window.location.assign('/login');
    if (result.kind === 'error') return setError(result.message);
    form.reset();
    setDone(others ? 'Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.' : 'Đã đổi mật khẩu.');
  }
  return (
    <form
      aria-labelledby="pw-title"
      className="flex max-w-[400px] flex-col gap-3"
      onSubmit={(e) => void submit(e)}
    >
      <h3 id="pw-title" className="text-16 font-semibold">
        Đổi mật khẩu
      </h3>
      <label className="flex flex-col gap-1">
        Mật khẩu hiện tại
        <input name="current" type="password" autoComplete="current-password" className={input} />
      </label>
      <label className="flex flex-col gap-1">
        Mật khẩu mới (12–128 ký tự, có chữ và số)
        <input name="next" type="password" autoComplete="new-password" className={input} />
      </label>
      <label className="flex flex-col gap-1">
        Nhập lại mật khẩu mới
        <input name="again" type="password" autoComplete="new-password" className={input} />
      </label>
      <label className="flex items-center gap-2">
        <input name="others" type="checkbox" defaultChecked />
        Đăng xuất các thiết bị khác
      </label>
      {error ? <p role="alert">{error}</p> : null}
      {done ? <p role="status">{done}</p> : null}
      <button type="submit" className={primary} disabled={busy} aria-busy={busy}>
        {busy ? 'Đang đổi…' : 'Đổi mật khẩu'}
      </button>
    </form>
  );
}

function SignOutOthers() {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  async function run() {
    setState('busy');
    const res = await post('/api/auth/revoke-other-sessions', {}).catch(() => null);
    if (res?.status === 401) return window.location.assign('/login');
    setState(res?.ok ? 'done' : 'error');
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <h3 className="text-16 font-semibold">Thiết bị khác</h3>
      <p className="text-text-muted">
        Đăng xuất mọi nơi khác đang đăng nhập bằng tài khoản này; phiên này vẫn giữ.
      </p>
      <button
        type="button"
        className={button}
        disabled={state === 'busy'}
        aria-busy={state === 'busy'}
        onClick={() => void run()}
      >
        Đăng xuất khỏi các thiết bị khác
      </button>
      {state === 'done' ? <p role="status">Đã đăng xuất các thiết bị khác.</p> : null}
      {state === 'error' ? (
        <p role="alert">Không đăng xuất được lúc này. Thử lại sau ít phút.</p>
      ) : null}
    </div>
  );
}

/** #5 Hồ sơ cá nhân (spec M8 §3.8): read-only information, password and other devices, notifications pending an API. */
export function Profile({
  tab,
  name,
  role,
  orgName,
  workspaces,
  twoFactorEnabled,
}: {
  tab: Tab;
  name: string;
  role: Role;
  orgName: string | null;
  workspaces: readonly string[];
  twoFactorEnabled: boolean;
}) {
  return (
    <section aria-labelledby="me-title" className="flex max-w-[720px] flex-col gap-4">
      <h1 id="me-title" className="text-20 font-semibold">
        Hồ sơ cá nhân
      </h1>
      <nav aria-label="Phần hồ sơ" className="flex gap-2 border-b border-border">
        {TABS.map(([k, label]) => (
          <Link
            key={k}
            href={`/me?tab=${k}`}
            aria-current={tab === k ? 'page' : undefined}
            className={`px-3 py-2 ${tab === k ? 'border-b-2 border-accent font-semibold' : 'text-text-muted'}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {tab === 'info' ? (
        <div className="flex flex-col gap-2">
          <dl className="grid grid-cols-[160px_1fr] gap-2">
            <dt className="text-text-muted">Tên</dt>
            <dd>{name}</dd>
            <dt className="text-text-muted">Vai trò</dt>
            <dd>{ROLE_NAME[role]}</dd>
            <dt className="text-text-muted">Công ty</dt>
            <dd>{orgName ?? 'Không thuộc công ty nào'}</dd>
            <dt className="text-text-muted">Workspace</dt>
            <dd>{workspaces.length ? workspaces.join(', ') : 'Chưa có'}</dd>
          </dl>
          <p className="text-12 text-text-muted">Đổi tên và ảnh đại diện: chờ API (U25).</p>
        </div>
      ) : tab === 'security' ? (
        <div className="flex flex-col gap-6">
          <p>
            Xác thực 2 lớp: <strong>{twoFactorEnabled ? 'Đã bật' : 'Chưa bật'}</strong>
          </p>
          <ChangePassword />
          <SignOutOthers />
        </div>
      ) : (
        <p>
          Cài đặt thông báo (trình duyệt, âm thanh): chờ API. Hiện chưa có thông báo nào để tắt.
        </p>
      )}
      <p className="text-12 text-text-muted">Không áp dụng AI ở màn này.</p>
    </section>
  );
}
