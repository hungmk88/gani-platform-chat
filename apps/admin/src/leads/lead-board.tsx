'use client';

import { useId } from 'react';

import type { NavItem } from '../nav';
import { uniqueRows } from '../paged';
import { button } from '../paged-list';
import { PendingPage } from '../pending-page';
import type { ApiFailure } from '../query/fetch';
import { useApiPages, useApiQuery, useScope } from '../query/provider';
import { RetryAction } from '../retry-button';
import {
  columnsOf,
  leadsPath,
  pipelinePath,
  STATUS,
  timeText,
  type Lead,
  type LeadPage,
  type Pipeline,
} from './leads';

const TONE = { ok: 'bg-ok-bg text-ok-text', error: 'bg-error-bg text-error-text' };
const badge = 'rounded-input px-2';

/** An error with its trace and "Thử lại" (Brief UI: one sentence, one action). */
function Failure({
  failure,
  retry,
  busy,
}: {
  failure: ApiFailure;
  retry: () => void;
  busy: boolean;
}) {
  return (
    <div role="alert" className="flex flex-col gap-2">
      <p>{failure.error.message}</p>
      {failure.error.traceId ? (
        <p className="text-12 text-text-muted">Mã: {failure.error.traceId}</p>
      ) : null}
      <RetryAction onRetry={retry} busy={busy} />
    </div>
  );
}

/** The state of a lead; a lost one says why on hover and on focus (brief 29 (2)), the reason given by the API. */
function StatusBadge({ lead }: { lead: Lead }) {
  const tip = useId();
  const [label, tone] = STATUS[lead.status];
  const cls = `${badge} ${tone ? TONE[tone] : 'bg-bg-subtle'}`;
  if (lead.status !== 'lost' || !lead.lostReason) return <span className={cls}>{label}</span>;
  return (
    <span className="group flex flex-col gap-1">
      <span tabIndex={0} aria-describedby={tip} className={`${cls} self-start`}>
        {label}
      </span>
      <span id={tip} role="tooltip" className="hidden group-focus-within:block group-hover:block">
        Lý do: {lead.lostReason}
      </span>
    </span>
  );
}

function LeadCard({ lead }: { lead: Lead }) {
  const owner = lead.owner ? (lead.owner.name ?? 'Chưa có tên') : 'Chưa giao';
  return (
    <article className="flex flex-col gap-1 rounded-card border border-border bg-surface p-2">
      <h3 className="font-semibold">{lead.title}</h3>
      <p className="text-12">Khách: {lead.customer?.displayName ?? 'Khách chưa có tên'}</p>
      <p className="text-12">Phụ trách: {owner}</p>
      <div className="flex flex-wrap items-start gap-1 text-12">
        <span className={`${badge} bg-bg-subtle`}>{lead.stage.name}</span>
        <StatusBadge lead={lead} />
      </div>
      <p className="text-12 text-text-muted">Cập nhật {timeText(lead.updatedAt)}</p>
    </article>
  );
}

/**
 * #12 Pipeline lead of the workspace being worked in (T1), read only (CEO 02/11, brief 29–30: 12a): the steps of the pipeline as
 * columns with their open leads, then Thắng and Thua. Every role of the company reads it, as the menu. A 404 of either route keeps
 * the screen of a menu item not built yet (`PendingPage`).
 */
export function LeadBoard({ item, go }: { item: NavItem; go: NavItem }) {
  const { workspaceId } = useScope();
  const ws = workspaceId ?? '';
  const prefix = useId();
  const stages = useApiQuery<Pipeline>(['leads', ws, 'pipeline'], pipelinePath(ws), !!ws);
  const leads = useApiPages<LeadPage>(['leads', ws], (c) => leadsPath(ws, c), !!ws);
  if (!workspaceId)
    return <p>Bạn chưa thuộc workspace nào. Nhờ Owner thêm bạn ở Cài đặt › Workspace.</p>;
  const notServed = [stages.error, leads.error].some((e) => e?.error.code === 'not_found');
  if (notServed) return <PendingPage item={item} go={go} />;
  const rows = leads.data ? uniqueRows(leads.data.pages) : [];
  const steps = stages.data?.data ?? [];
  let body;
  if (stages.isError)
    body = (
      <Failure
        failure={stages.error}
        retry={() => void stages.refetch()}
        busy={stages.isFetching}
      />
    );
  else if (leads.isError && !leads.data)
    body = (
      <Failure failure={leads.error} retry={() => void leads.refetch()} busy={leads.isFetching} />
    );
  else if (stages.isPending || leads.isPending)
    body = (
      <p role="status" aria-busy="true" className="text-text-muted">
        Đang tải pipeline…
      </p>
    );
  else if (rows.length === 0)
    body = (
      <div className="flex flex-col gap-2">
        <p>Workspace chưa có lead nào.</p>
        <button
          type="button"
          className={button}
          disabled={leads.isFetching}
          aria-busy={leads.isFetching}
          onClick={() => void leads.refetch()}
        >
          Làm mới
        </button>
      </div>
    );
  else
    body = (
      <>
        <div
          role="region"
          aria-label="Các bước của pipeline"
          tabIndex={0}
          className="flex gap-3 overflow-x-auto pb-2"
        >
          {columnsOf(steps, rows).map((c) => (
            <section
              key={c.key}
              aria-labelledby={`${prefix}-${c.key}`}
              className="flex w-60 shrink-0 flex-col gap-2 rounded-card bg-bg-subtle p-2"
            >
              <h2 id={`${prefix}-${c.key}`} className="font-semibold">
                {c.title} <span className="text-text-muted">({c.leads.length})</span>
              </h2>
              {c.leads.length ? (
                <ul className="flex flex-col gap-2">
                  {c.leads.map((l) => (
                    <li key={l.id}>
                      <LeadCard lead={l} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-12 text-text-muted">Chưa có lead</p>
              )}
            </section>
          ))}
        </div>
        {leads.isFetchNextPageError && leads.error ? (
          <Failure
            failure={leads.error}
            retry={() => void leads.fetchNextPage()}
            busy={leads.isFetching}
          />
        ) : leads.hasNextPage ? (
          <button
            type="button"
            className={button}
            disabled={leads.isFetchingNextPage}
            aria-busy={leads.isFetchingNextPage}
            onClick={() => void leads.fetchNextPage()}
          >
            {leads.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
          </button>
        ) : null}
      </>
    );
  return (
    <section aria-labelledby="leads-title" className="flex flex-col gap-4">
      <h1 id="leads-title" className="text-20 font-semibold">
        Pipeline lead
      </h1>
      {body}
      <p className="text-12 text-text-muted">
        Chỉ xem: không tạo lead, không chuyển bước hay đánh dấu Thắng/Thua ở màn này. Không áp dụng
        AI.
      </p>
    </section>
  );
}
