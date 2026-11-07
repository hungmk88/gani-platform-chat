'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import { AGENT_STATUS } from '../agent-status';
import { useApiQuery } from '../query/provider';
import { RetryAction } from '../retry-button';
import { timeText } from '../security/security';
import { busyText, teamStatusPath, type TeamAgentStatusList } from './team-status';
import type { Team } from './teams';

const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const TONE: Partial<Record<keyof typeof AGENT_STATUS, string>> = {
  online: 'bg-ok-bg text-ok-text',
  busy: 'bg-warn-bg text-warn-text',
};

/**
 * "Trạng thái" of a team (U85): each member who holds conversations, by name as the API gives, read only. While the API does not
 * serve it (404, planned S4) the dialog says it is not there yet, like `PendingPage`; nothing is made up. No threshold is drawn on
 * the minutes "Bận" (Q7). The dialog opens while the list loads, so the focus is on the dialog itself (#411).
 */
export function TeamStatusDialog(props: { team: Team; onClose: () => void }) {
  const { team } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const status = useApiQuery<TeamAgentStatusList>(
    ['teams', 'agent-status', team.id],
    teamStatusPath(team.id),
  );
  useEffect(() => (dialog.current?.showModal(), dialog.current?.focus()), []);
  const rows = status.data?.data ?? [];

  let body: ReactNode;
  if (status.isPending)
    body = (
      <p role="status" aria-busy="true" className="text-text-muted">
        Đang tải trạng thái…
      </p>
    );
  else if (status.isError && status.error.error.code === 'not_found')
    body = <p>Trạng thái team: chưa có trong bản hiện tại.</p>;
  else if (status.isError)
    body = (
      <div role="alert" className="flex flex-col gap-2">
        <p>{status.error.error.message}</p>
        {status.error.error.traceId ? (
          <p className="text-12 text-text-muted">Mã: {status.error.error.traceId}</p>
        ) : null}
        <RetryAction onRetry={() => void status.refetch()} busy={status.isFetching} />
      </div>
    );
  else if (!rows.length) body = <p>Team chưa có người giữ hội thoại.</p>;
  else
    body = (
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full text-left">
          <thead className="bg-bg-subtle">
            <tr>
              {['Người', 'Trạng thái', 'Từ lúc', 'Bận hôm nay'].map((t) => (
                <th key={t} scope="col" className="p-2 font-semibold">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((a) => (
              <tr key={a.userId}>
                <td className="p-2">{a.name ?? 'Chưa có tên'}</td>
                <td className="p-2">
                  <span className={`rounded-input px-2 ${TONE[a.status] ?? ''}`}>
                    {AGENT_STATUS[a.status]}
                  </span>
                </td>
                <td className="p-2">{timeText(a.since)}</td>
                <td className="p-2">{busyText(a.busyMinutesToday)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <dialog
      ref={dialog}
      tabIndex={-1}
      aria-labelledby="team-status-title"
      onClose={props.onClose}
      className="m-auto w-[640px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay"
    >
      <div className="flex flex-col gap-3">
        <h3 id="team-status-title" className="text-16 font-semibold">
          Trạng thái team {team.name}
        </h3>
        <p>Người giữ hội thoại của team, theo tên. &quot;Bận hôm nay&quot; tính từ 00:00.</p>
        {body}
        <div>
          <button type="button" className={button} onClick={() => dialog.current?.close()}>
            Đóng
          </button>
        </div>
      </div>
    </dialog>
  );
}
