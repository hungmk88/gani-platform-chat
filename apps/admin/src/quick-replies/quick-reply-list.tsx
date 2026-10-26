'use client';

import { useDeferredValue, useState } from 'react';

import { useApiQuery } from '../query/provider';
import { RetryAction } from '../retry-button';
import {
  MAX_QUERY,
  quickRepliesPath,
  usedText,
  type QuickReply,
  type QuickReplyFilter,
  type QuickReplyList,
} from './quick-replies';
import { EditQuickReplyDialog, EndQuickReplyDialog } from './quick-reply-dialogs';
import { PreviewQuickReplyDialog } from './quick-reply-preview';

const field = 'rounded-input border border-border-strong px-3 py-2';
const tagButton = 'rounded-input bg-bg-subtle px-2 py-1 text-12';
const button = 'rounded-input border border-border-strong px-3 py-1';

/**
 * The templates of the workspace being worked in (#22, `GET /v1/quick-replies`, N163), most used first as the API sorts them: the
 * shortcut typed after "/" in the Inbox, the text as plain text, the tags and how often it was used. Searched by the start of a
 * shortcut; a tag of a row filters by that tag. Each is seen with sample values (`PreviewQuickReplyDialog`), changed (`EditQuickReplyDialog`) or
 * removed (`EndQuickReplyDialog`) from its row.
 */
export function QuickReplyTable({ workspaceId }: { workspaceId: string }) {
  const [q, setQ] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const filter: QuickReplyFilter = { q: useDeferredValue(q), tag };
  const path = quickRepliesPath(workspaceId, filter);
  const list = useApiQuery<QuickReplyList>(['quick-replies', workspaceId, path], path);
  const filtered = Boolean(filter.q.trim() || tag);
  const [editing, setEditing] = useState<QuickReply | null>(null);
  const [ending, setEnding] = useState<QuickReply | null>(null);
  const [previewing, setPreviewing] = useState<QuickReply | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const open = (set: (r: QuickReply) => void) => (r: QuickReply) => {
    setNotice(null);
    set(r);
  };

  return (
    <section aria-labelledby="quick-replies-title" className="flex flex-col gap-3">
      <h2 id="quick-replies-title" className="text-16 font-semibold">
        Mẫu của workspace
      </h2>
      {notice ? <p role="status">{notice}</p> : null}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          Tìm theo phím tắt
          <input
            type="search"
            value={q}
            maxLength={MAX_QUERY}
            className={field}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        {tag ? (
          <button type="button" className={tagButton} onClick={() => setTag(null)}>
            Bỏ lọc tag “{tag}”
          </button>
        ) : null}
      </div>
      {list.isPending ? (
        <p role="status" aria-busy="true" className="text-text-muted">
          Đang tải mẫu…
        </p>
      ) : list.isError ? (
        <div role="alert" className="flex flex-col gap-2">
          <p>{list.error.error.message}</p>
          {list.error.error.traceId ? (
            <p className="text-12 text-text-muted">Mã: {list.error.error.traceId}</p>
          ) : null}
          <RetryAction onRetry={() => void list.refetch()} busy={list.isFetching} />
        </div>
      ) : list.data.data.length === 0 ? (
        filtered ? (
          <p>Không có mẫu nào khớp. Đổi từ tìm hoặc bỏ lọc tag.</p>
        ) : (
          <p>Workspace này chưa có mẫu trả lời nào. Tạo mẫu đầu tiên bằng form ở trên.</p>
        )
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-card border border-border">
          {list.data.data.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">/{r.shortcut}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-12 text-text-muted">{usedText(r.useCount)}</span>
                  <button
                    type="button"
                    className={button}
                    aria-label={`Xem trước mẫu /${r.shortcut}`}
                    onClick={() => open(setPreviewing)(r)}
                  >
                    Xem trước
                  </button>
                  <button
                    type="button"
                    className={button}
                    aria-label={`Sửa mẫu /${r.shortcut}`}
                    onClick={() => open(setEditing)(r)}
                  >
                    Sửa
                  </button>
                  <button
                    type="button"
                    className={button}
                    aria-label={`Xóa mẫu /${r.shortcut}`}
                    onClick={() => open(setEnding)(r)}
                  >
                    Xóa…
                  </button>
                </span>
              </div>
              <p className="whitespace-pre-wrap">{r.body}</p>
              {r.tags.length ? (
                <div className="flex flex-wrap gap-2">
                  {r.tags.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={tagButton}
                      aria-label={`Lọc theo tag ${t}`}
                      aria-pressed={tag === t}
                      onClick={() => setTag(tag === t ? null : t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {previewing ? (
        <PreviewQuickReplyDialog
          key={previewing.id}
          reply={previewing}
          onClose={() => setPreviewing(null)}
        />
      ) : null}
      {editing ? (
        <EditQuickReplyDialog
          key={editing.id}
          reply={editing}
          onClose={() => setEditing(null)}
          onDone={(r) => setNotice(`Đã lưu mẫu /${r.shortcut}.`)}
        />
      ) : null}
      {ending ? (
        <EndQuickReplyDialog
          key={ending.id}
          reply={ending}
          onClose={() => setEnding(null)}
          onDone={(r) => setNotice(`Đã xóa mẫu /${r.shortcut}.`)}
        />
      ) : null}
    </section>
  );
}
