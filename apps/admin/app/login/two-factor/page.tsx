import type { Metadata } from 'next';

import { TwoFactorForm } from '../../../src/two-factor-form';

export const metadata: Metadata = { title: 'Xác thực 2 lớp — Gani Platform' };

export default function TwoFactor() {
  return (
    <main className="mx-auto mt-8 flex max-w-[400px] flex-col gap-4 rounded-card border border-border bg-surface p-6">
      <h1 className="text-20 font-semibold">Xác thực 2 lớp</h1>
      <TwoFactorForm />
    </main>
  );
}
