import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getSecurityStatus } from '../../../src/me.server';
import { SystemPage } from '../../../src/system-page';
import { TwoFactorSetupForm } from '../../../src/two-factor-setup-form';

export const metadata: Metadata = { title: 'Cài xác thực 2 lớp — Gani Platform' };

/** Open to a person who must set up 2FA (the API lets only these routes through, N93) and to one who chooses to; not twice. */
export default async function TwoFactorSetup() {
  const status = await getSecurityStatus();
  if (status.kind === 'signed_out') redirect('/login');
  if (status.kind === 'signed_in' && status.twoFactorEnabled) redirect('/');
  if (status.kind === 'error') return <SystemPage kind="error" traceId={status.traceId} />;
  return (
    <main className="mx-auto mt-8 flex max-w-[480px] flex-col gap-4 rounded-card border border-border bg-surface p-6">
      <h1 className="text-20 font-semibold">Cài xác thực 2 lớp</h1>
      {status.kind === 'must_set_up' ? (
        <p className="text-text-muted">
          Vai trò của bạn bắt buộc xác thực 2 lớp. Cài xong mới dùng được hệ thống.
        </p>
      ) : null}
      <TwoFactorSetupForm />
    </main>
  );
}
