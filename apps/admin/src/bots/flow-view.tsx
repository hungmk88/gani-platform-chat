'use client';

import Link from 'next/link';

import { useApiQuery } from '../query/provider';
import { RetryAction } from '../retry-button';
import {
  draftText,
  flowPath,
  publishedText,
  sizeText,
  STATUS,
  timeText,
  type BotFlowDetail,
} from './bot-flows';
import { TONE } from './flow-list';

const back = (
  <Link href="/bots" className="self-start underline">
    Về danh sách flow
  </Link>
);

/**
 * Chi tiết bot flow (#17, CEO 01/11, read only): its state, the version published last and when, what the draft holds against it,
 * the size of each, when it was made and changed. No graph here (part B), no button that writes.
 */
export function FlowView({ id }: { id: string }) {
  const flow = useApiQuery<BotFlowDetail>(['bot-flow', id], flowPath(id));
  if (flow.isPending)
    return (
      <p role="status" aria-busy="true" className="text-text-muted">
        Đang tải flow…
      </p>
    );
  if (flow.isError) {
    const { error } = flow.error;
    // A flow deleted, of another company or outside the person's workspaces is a 404 (P9); a malformed id is no better.
    if (error.code === 'not_found' || error.code === 'validation_failed')
      return (
        <div className="flex flex-col items-start gap-2">
          <h1 className="text-20 font-semibold">Không tìm thấy flow</h1>
          <p>Có thể flow đã bị xóa hoặc thuộc workspace bạn không được xem.</p>
          {back}
        </div>
      );
    return (
      <div role="alert" className="flex flex-col gap-2">
        <p>{error.message}</p>
        {error.traceId ? <p className="text-12 text-text-muted">Mã: {error.traceId}</p> : null}
        <RetryAction onRetry={() => void flow.refetch()} busy={flow.isFetching} />
      </div>
    );
  }
  const f = flow.data;
  const [label, tone] = STATUS[f.status];
  const at = f.published?.publishedAt;
  return (
    <>
      {back}
      <h1 className="text-20 font-semibold">{f.name}</h1>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
        <dt className="text-text-muted">Trạng thái</dt>
        <dd>
          <span className={`rounded-input px-2 ${tone ? TONE[tone] : 'bg-bg-subtle'}`}>
            {label}
          </span>
        </dd>
        <dt className="text-text-muted">Bản đã xuất bản</dt>
        <dd>
          {publishedText(f.published?.version ?? f.publishedVersion)}
          {at ? `, xuất bản lúc ${timeText(at)}` : null}
          {f.published ? ` · ${sizeText(f.published.graph)}` : null}
        </dd>
        <dt className="text-text-muted">Bản nháp</dt>
        <dd>
          {sizeText(f.draft.graph)} · {draftText(f)}
        </dd>
        <dt className="text-text-muted">Tạo lúc</dt>
        <dd>{timeText(f.createdAt)}</dd>
        <dt className="text-text-muted">Cập nhật lúc</dt>
        <dd>{timeText(f.updatedAt)}</dd>
      </dl>
    </>
  );
}
