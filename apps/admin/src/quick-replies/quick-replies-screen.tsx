'use client';

import { useScope } from '../query/provider';
import { QuickReplyForm } from './quick-reply-form';
import { QuickReplyTable } from './quick-reply-list';

/** #22 Mẫu trả lời nhanh for the workspace being worked in (chosen in the top bar, T1): make a template, then the list. */
export function QuickRepliesScreen() {
  const { workspaceId } = useScope();
  if (!workspaceId)
    return <p>Bạn chưa thuộc workspace nào. Nhờ Owner thêm bạn ở Cài đặt › Workspace.</p>;
  return (
    <>
      <QuickReplyForm workspaceId={workspaceId} />
      <QuickReplyTable workspaceId={workspaceId} />
    </>
  );
}
