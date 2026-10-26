import type { Metadata } from 'next';

import { roleOf } from '../../../../src/me';
import { getMe } from '../../../../src/me.server';
import { mayManageQuickReplies } from '../../../../src/quick-replies/quick-replies';
import { QuickReplyTable } from '../../../../src/quick-replies/quick-reply-list';
import { SystemPage } from '../../../../src/system-page';

export const metadata: Metadata = { title: 'Mẫu trả lời nhanh — Gani Platform' };

/**
 * #22 Mẫu trả lời nhanh (C7, N163), Owner, Admin and Manager as the menu (Phụ lục B "Quản lý mẫu trả lời nhanh"): the templates of
 * the workspace being worked in. Making, changing and removing one, and the preview, come with the routes of C7b–c.
 */
export default async function QuickRepliesPage() {
  const result = await getMe();
  const role = result.kind === 'ok' ? roleOf(result.me) : null;
  if (!mayManageQuickReplies(role)) return <SystemPage kind="forbidden" />;
  return (
    <section
      aria-labelledby="quick-replies-page-title"
      className="flex max-w-[880px] flex-col gap-6"
    >
      <h1 id="quick-replies-page-title" className="text-20 font-semibold">
        Mẫu trả lời nhanh
      </h1>
      <QuickReplyTable />
      <p className="text-12 text-text-muted">
        Tạo, sửa, xóa, xem trước mẫu và dùng mẫu trong Hộp thư (gõ “/”): chưa có trong bản hiện tại.
      </p>
      <p className="text-12 text-text-muted">Không áp dụng AI ở màn này.</p>
    </section>
  );
}
