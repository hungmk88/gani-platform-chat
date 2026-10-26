import type { Metadata } from 'next';

import { CustomerList } from '../../../src/customers/customer-list';
import { mayReadCustomers } from '../../../src/customers/customers';
import { roleOf } from '../../../src/me';
import { getMe } from '../../../src/me.server';
import { SystemPage } from '../../../src/system-page';

export const metadata: Metadata = { title: 'Khách hàng — Gani Platform' };

/** #7 Khách hàng (J1, N165): every role of a company, one profile per customer for all the company's workspaces. */
export default async function CustomersPage() {
  const result = await getMe();
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  if (!mayReadCustomers(role)) return <SystemPage kind="forbidden" />;
  return (
    <section aria-labelledby="customers-title" className="flex max-w-[960px] flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 id="customers-title" className="text-20 font-semibold">
          Khách hàng
        </h1>
        <p className="text-text-muted">Hồ sơ khách dùng chung cho mọi workspace của công ty.</p>
      </div>
      <CustomerList role={role} />
      <p className="text-12 text-text-muted">Không áp dụng AI ở màn này.</p>
    </section>
  );
}
