import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { FlowView } from '../../../../src/bots/flow-view';
import { roleOf } from '../../../../src/me';
import { getMe } from '../../../../src/me.server';
import { menuItemAt } from '../../../../src/nav';

export const metadata: Metadata = { title: 'Bot — Gani Platform' };

/** Chi tiết bot flow (#17, CEO 01/11: read only): the same roles as the list. */
export default async function BotPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, result] = await Promise.all([params, getMe()]);
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  if (!role || !menuItemAt(role, '/bots')) notFound();
  return (
    <section aria-label="Chi tiết flow" className="flex max-w-[720px] flex-col gap-4">
      <FlowView id={id} />
    </section>
  );
}
