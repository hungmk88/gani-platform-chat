import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { roleOf } from '../../../src/me';
import { getMe } from '../../../src/me.server';
import { menuItemAt } from '../../../src/nav';
import { tabOf } from '../../../src/platform/platform';
import { PlatformScreen } from '../../../src/platform/platform-screen';

export const metadata: Metadata = { title: 'Platform — Gani Platform' };

/**
 * #30 Platform (U28, PR 30a, CEO 05/11, brief 79): the platform operator only, the one role whose menu has it; any other role gets
 * the 404 inside the frame, as any path outside its menu. Tabs by `?tab=`.
 */
export default async function PlatformPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const [result, { tab }] = await Promise.all([getMe(), searchParams]);
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  const item = role ? menuItemAt(role, '/platform') : undefined;
  if (result.kind !== 'ok' || !role || !item) notFound();
  return <PlatformScreen tab={tabOf(tab)} meId={result.me.id} />;
}
