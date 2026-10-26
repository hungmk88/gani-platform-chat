import type { Metadata } from 'next';

import { ForgotForm } from '../../src/forgot-form';

export const metadata: Metadata = { title: 'Quên mật khẩu — Gani Platform' };

/** "Quên mật khẩu" (PR7, N162): outside the frame of the app, for a person who cannot sign in. */
export default function ForgotPassword() {
  return (
    <main className="mx-auto mt-8 flex max-w-[400px] flex-col gap-4 rounded-card border border-border bg-surface p-6">
      <h1 className="text-20 font-semibold">Quên mật khẩu</h1>
      <p className="text-text-muted">Nhập email đăng nhập: chúng tôi gửi link đặt mật khẩu mới.</p>
      <ForgotForm />
    </main>
  );
}
