'use client';

import { useState, type ReactNode } from 'react';

import { useApiQuery, useScope } from '../query/provider';
import { RetryAction } from '../retry-button';
import type { WorkspaceList } from '../workspaces/workspace';
import { BudgetDialog } from './budget-dialog';
import { FeatureToggle } from './feature-toggle';
import {
  budgetOf,
  ENVIRONMENT,
  FEATURES,
  PRODUCTION_LOCK,
  resetText,
  settingsPath,
  type AiSettings,
} from './settings';

const button = 'self-start rounded-input border border-border-strong px-3 py-1';
const TONE = { warn: 'bg-warn-bg text-warn-text', error: 'bg-error-bg text-error-text' };

/** One block: its heading and its lines, a term and what it is. */
function Block({
  title,
  children,
  after,
}: {
  title: string;
  children: ReactNode;
  after?: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="text-16 font-semibold">{title}</h2>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[max-content_1fr]">{children}</dl>
      {after}
    </section>
  );
}

/**
 * #26 part A: the environment, E1/L1 and the monthly budget of the workspace being worked in; B1a turns E1/L1 on or off, B1b changes
 * the budget. Its own loading, error and 404: a 404 (the API does not serve the route yet) keeps the one line the screen had, the
 * prompt table stays.
 */
export function AiSettingsBlocks() {
  const { workspaceId } = useScope();
  const ws = workspaceId ?? '';
  const settings = useApiQuery<AiSettings>(
    ['ai', 'settings', ws],
    settingsPath(ws),
    Boolean(workspaceId),
  );
  // The zone of the month: the workspace's, from the list Owner and Admin read (#21); without it, Viet Nam's time, said so.
  const workspaces = useApiQuery<WorkspaceList>(['workspaces'], '/v1/workspaces');
  const timezone = workspaces.data?.data.find((w) => w.id === workspaceId)?.timezone ?? null;
  const [editing, setEditing] = useState(false);
  if (!workspaceId)
    return <p>Bạn chưa thuộc workspace nào. Nhờ Owner thêm bạn ở Cài đặt › Workspace.</p>;
  if (settings.isPending)
    return (
      <p role="status" aria-busy="true" className="text-text-muted">
        Đang tải môi trường, tính năng và ngân sách…
      </p>
    );
  if (settings.isError) {
    const { error } = settings.error;
    if (error.code === 'not_found')
      return (
        <p className="text-12 text-text-muted">
          Môi trường, tính năng và ngân sách AI chưa có trong bản hiện tại.
        </p>
      );
    return (
      <div role="alert" className="flex flex-col gap-2">
        <p>{error.message}</p>
        {error.traceId ? <p className="text-12 text-text-muted">Mã: {error.traceId}</p> : null}
        <RetryAction onRetry={() => void settings.refetch()} busy={settings.isFetching} />
      </div>
    );
  }
  const s = settings.data;
  const budget = budgetOf(s);
  const reset = resetText(s.resetsAt, timezone);
  return (
    <>
      <Block title="Môi trường">
        <dt>Đang chạy ở</dt>
        <dd>{ENVIRONMENT[s.environment]}</dd>
      </Block>
      <Block
        title="Tính năng"
        after={
          s.environment === 'production' ? (
            <p id="ai-production-lock" className="text-12 text-text-muted">
              {PRODUCTION_LOCK}
            </p>
          ) : null
        }
      >
        {FEATURES.map(([key, name]) => (
          <div key={key} className="contents">
            <dt>{name}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              {s.features[key] ? (
                <span className="rounded-input bg-ok-bg px-2 text-ok-text">Đang bật</span>
              ) : (
                'Đang tắt'
              )}
              <FeatureToggle feature={key} name={name} settings={s} lockId="ai-production-lock" />
            </dd>
          </div>
        ))}
      </Block>
      <Block
        title="Ngân sách tháng"
        after={
          <button type="button" className={button} onClick={() => setEditing(true)}>
            Sửa ngân sách
          </button>
        }
      >
        <dt>Đã dùng / ngân sách</dt>
        <dd>
          {budget.used}
          {budget.note && budget.tone ? (
            <span className={`ml-2 rounded-input px-2 ${TONE[budget.tone]}`}>{budget.note}</span>
          ) : null}
        </dd>
        <dt>Đặt lại lúc</dt>
        <dd>{reset}</dd>
      </Block>
      {editing ? (
        <BudgetDialog settings={s} reset={reset} onClose={() => setEditing(false)} />
      ) : null}
      <p className="text-12 text-text-muted">Không đổi môi trường ở màn này.</p>
    </>
  );
}
