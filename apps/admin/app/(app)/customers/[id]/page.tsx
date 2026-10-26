import type { Metadata } from 'next';

import { CustomerProfile } from '../../../../src/customers/customer-profile';
import { mayReadCustomers } from '../../../../src/customers/customers';
import { roleOf } from '../../../../src/me';
import { getMe } from '../../../../src/me.server';
import { SystemPage } from '../../../../src/system-page';

export const metadata: Metadata = { title: 'Hồ sơ khách — Gani Platform' };

/** #8 Hồ sơ khách (J1, N165): the same roles as the list (#7). */
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, result] = await Promise.all([params, getMe()]);
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  if (!mayReadCustomers(role)) return <SystemPage kind="forbidden" />;
  return (
    <section aria-label="Hồ sơ khách" className="flex max-w-[720px] flex-col gap-6">
      <CustomerProfile id={id} role={role} />
      <p className="text-12 text-text-muted">Không áp dụng AI ở màn này.</p>
    </section>
  );
}
