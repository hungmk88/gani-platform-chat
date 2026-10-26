import type { Metadata } from 'next';

import { ResetForm } from '../../src/reset-form';

export const metadata: Metadata = { title: 'Đặt lại mật khẩu — Gani Platform' };

/** "Đặt lại mật khẩu" (PR7, N162): outside the frame of the app; the link of the email lands here (`#token=…`). */
export default function ResetPassword() {
  return (
    <main className="mx-auto mt-8 flex max-w-[400px] flex-col gap-4 rounded-card border border-border bg-surface p-6">
      <ResetForm />
    </main>
  );
}
