import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { roleOf } from '../../../src/me';
import { getMe } from '../../../src/me.server';
import { builtFor, menuItemAt } from '../../../src/nav';
import { OverviewScreen } from '../../../src/overview/overview-screen';

export const metadata: Metadata = { title: 'Tổng quan — Gani Platform' };

/** #16 Tổng quan (U29, N167), every role of a company as the menu: Sales and Support see their own figures (the API's scope `me`). */
export default async function OverviewPage() {
  const result = await getMe();
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  const item = role ? menuItemAt(role, '/overview') : undefined;
  if (!role || !item) notFound();
  return <OverviewScreen item={item} go={builtFor(role)} />;
}
