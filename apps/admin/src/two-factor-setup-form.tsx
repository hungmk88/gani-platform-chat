'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { QrCode } from './qr-code';
import { readVerify, UNAVAILABLE as VERIFY_UNAVAILABLE, VERIFY_PATH } from './two-factor';
import { backupCodesFile, manualKey, readEnable, UNAVAILABLE } from './two-factor-setup';

const input = 'rounded-input border border-border-strong bg-surface px-3 py-2';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';
const secondary = 'rounded-input border border-border-strong px-4 py-2';
const post = (path: string, body: unknown) =>
  fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => undefined);

type Step =
  | { name: 'password' }
  | { name: 'scan'; totpURI: string; codes: readonly string[] }
  | { name: 'codes'; codes: readonly string[] };

/** #2 enrol (spec M8 §3.8, Q-U20-2): password (asked by the API), QR + 6 digits, then the 10 backup codes once, ticked as saved. */
export function TwoFactorSetupForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ name: 'password' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const done = () => {
    router.replace('/');
    router.refresh();
  };

  async function enable(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await post('/api/auth/two-factor/enable', {
      password: new FormData(e.currentTarget).get('password'),
    });
    const result = res ? await readEnable(res) : ({ kind: 'error', message: UNAVAILABLE } as const);
    setBusy(false);
    if (result.kind === 'ok')
      setStep({ name: 'scan', totpURI: result.totpURI, codes: result.backupCodes });
    else if (result.kind === 'already_on') done();
    else setError(result.message);
  }

  async function confirm(e: FormEvent<HTMLFormElement>, codes: readonly string[]) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await post(VERIFY_PATH.totp, {
      code: (new FormData(e.currentTarget).get('code') as string | null)?.trim() ?? '',
    });
    const result = res
      ? await readVerify(res, 'totp')
      : ({ kind: 'error', message: VERIFY_UNAVAILABLE, restart: false } as const);
    setBusy(false);
    if (result.kind === 'ok') setStep({ name: 'codes', codes });
    else setError(result.message);
  }

  function download(codes: readonly string[]) {
    const url = URL.createObjectURL(
      new Blob([backupCodesFile(codes)], { type: 'text/plain;charset=utf-8' }),
    );
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: 'gani-ma-du-phong-2fa.txt',
    });
    a.click();
    URL.revokeObjectURL(url);
  }

  const alert = error ? (
    <p role="alert" className="text-error-text">
      {error}
    </p>
  ) : null;

  if (step.name === 'password')
    return (
      <form className="flex flex-col gap-4" onSubmit={(e) => void enable(e)}>
        <p>Bước 1/3 — Nhập lại mật khẩu để bật xác thực 2 lớp.</p>
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
        {alert}
        <button type="submit" disabled={busy} aria-busy={busy} className={primary}>
          {busy ? 'Đang kiểm tra…' : 'Tiếp tục'}
        </button>
      </form>
    );

  if (step.name === 'scan')
    return (
      <form className="flex flex-col gap-4" onSubmit={(e) => void confirm(e, step.codes)}>
        <p>
          Bước 2/3 — Quét mã QR bằng ứng dụng xác thực (Google Authenticator, Microsoft
          Authenticator…).
        </p>
        <QrCode value={step.totpURI} label="Mã QR để thêm tài khoản vào ứng dụng xác thực" />
        <p className="text-12 text-text-muted">
          Không quét được? Nhập khóa thủ công: {manualKey(step.totpURI)}
        </p>
        <label className="flex flex-col gap-1">
          Mã 6 số trong ứng dụng
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
        {alert}
        <button type="submit" disabled={busy} aria-busy={busy} className={primary}>
          {busy ? 'Đang xác nhận…' : 'Xác nhận'}
        </button>
      </form>
    );

  return (
    <div className="flex flex-col gap-4">
      <p>
        Bước 3/3 — 10 mã dự phòng. Mỗi mã dùng 1 lần khi mất điện thoại.{' '}
        <strong>Mã chỉ hiện 1 lần này.</strong>
      </p>
      <ol className="grid grid-cols-2 gap-2 font-mono">
        {step.codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="flex gap-2">
        <button
          type="button"
          className={secondary}
          onClick={() =>
            void navigator.clipboard.writeText(step.codes.join('\n')).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          {copied ? 'Đã chép' : 'Chép'}
        </button>
        <button type="button" className={secondary} onClick={() => download(step.codes)}>
          Tải tệp .txt
        </button>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        Tôi đã lưu 10 mã dự phòng ở nơi an toàn
      </label>
      <button type="button" disabled={!saved} className={primary} onClick={done}>
        Xong
      </button>
    </div>
  );
}
