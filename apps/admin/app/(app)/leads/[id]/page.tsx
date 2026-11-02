import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { readsConversations } from '../../../../src/inbox/actions';
import { LeadDetailView } from '../../../../src/leads/lead-detail-view';
import { roleOf } from '../../../../src/me';
import { getMe } from '../../../../src/me.server';
import { menuItemAt } from '../../../../src/nav';

export const metadata: Metadata = { title: 'Chi tiết lead — Gani Platform' };

/** #13a Chi tiết lead (brief 36, 44–45, read only): the roles of `/leads`, as the menu; anyone else, the 404. */
export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, result] = await Promise.all([params, getMe()]);
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  if (result.kind !== 'ok' || !role || !menuItemAt(role, '/leads')) notFound();
  return (
    <section aria-label="Chi tiết lead" className="flex max-w-[720px] flex-col gap-6">
      <LeadDetailView id={id} meId={result.me.id} readsInbox={readsConversations(role)} />
      <p className="text-12 text-text-muted">
        Chỉ xem: không chuyển bước hay đánh dấu Thắng/Thua ở màn này. Không áp dụng AI.
      </p>
    </section>
  );
}
