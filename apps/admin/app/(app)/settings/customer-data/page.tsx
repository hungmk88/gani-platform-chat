import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { tabOf } from '../../../../src/customer-data/catalog';
import { CatalogScreen, CustomerDataNav } from '../../../../src/customer-data/catalog-screen';
import { roleOf } from '../../../../src/me';
import { getMe } from '../../../../src/me.server';
import { builtFor, menuItemAt } from '../../../../src/nav';
import { PrivacyScreen } from '../../../../src/privacy/privacy-screen';

export const metadata: Metadata = { title: 'Dữ liệu khách — Gani Platform' };

/**
 * #23 Dữ liệu khách (CEO 30/10; tabs CEO 02/11, brief 33, 46): Owner and Admin as the menu and the API (Phụ lục B "Xử lý yêu cầu
 * dữ liệu cá nhân", U36). Tabs by `?tab=` (`TABS`): the requests on personal data, then the custom fields. Outside the menu of the
 * role it is the 404 inside the frame, as any such path.
 */
export default async function CustomerDataPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const [result, { tab: raw }] = await Promise.all([getMe(), searchParams]);
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  const item = role ? menuItemAt(role, '/settings/customer-data') : undefined;
  if (!role || !item) notFound();
  const tab = tabOf(raw);
  const nav = <CustomerDataNav tab={tab} />;
  if (tab === 'requests') return <PrivacyScreen item={item} go={builtFor(role)} nav={nav} />;
  return <CatalogScreen tab={tab} nav={nav} />;
}
