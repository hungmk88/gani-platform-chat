import type { Metadata } from 'next';

import { LoginForm } from '../../src/login-form';

export const metadata: Metadata = { title: 'Đăng nhập — Gani Platform' };

export default function Login() {
  return (
    <main className="mx-auto mt-8 flex max-w-[400px] flex-col gap-4 rounded-card border border-border bg-surface p-6">
      <h1 className="text-20 font-semibold">Đăng nhập</h1>
      <p className="text-text-muted">Nền tảng chat — dùng chung cho 5 công ty.</p>
      <LoginForm />
      <p className="text-12 text-text-muted">
        Owner, Admin và platform operator bắt buộc xác thực 2 lớp.
      </p>
    </main>
  );
}
