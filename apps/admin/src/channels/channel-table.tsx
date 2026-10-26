'use client';

import { useApiQuery, useScope } from '../query/provider';
import { RetryAction } from '../retry-button';
import { teamsPath, type TeamList } from '../teams/teams';
import {
  answeringTeam,
  CHANNEL_STATUS,
  CHANNEL_TYPE,
  channelsPath,
  type ChannelList,
} from './channels';

const tone = {
  ok: 'bg-ok-bg text-ok-text',
  warn: 'bg-warn-bg text-warn-text',
  error: 'bg-error-bg text-error-text',
} as const;

/**
 * The channels of the workspace being worked in (#24, `GET /v1/channels?workspaceId=`, N161), by name: type, connection status and
 * the team that answers each (names from `GET /v1/teams`, N160). Read only: connecting and the rest wait for U26.
 */
export function ChannelTable() {
  const { workspaceId } = useScope();
  if (!workspaceId)
    return <p>Bạn chưa thuộc workspace nào. Nhờ Owner thêm bạn ở Cài đặt › Workspace.</p>;
  return <Channels workspaceId={workspaceId} />;
}

function Channels({ workspaceId }: { workspaceId: string }) {
  const list = useApiQuery<ChannelList>(['channels', workspaceId], channelsPath(workspaceId));
  const teams = useApiQuery<TeamList>(['teams', workspaceId], teamsPath(workspaceId));

  if (list.isPending)
    return (
      <p role="status" aria-busy="true" className="text-text-muted">
        Đang tải kênh…
      </p>
    );
  if (list.isError)
    return (
      <div role="alert" className="flex flex-col gap-2">
        <p>{list.error.error.message}</p>
        {list.error.error.traceId ? (
          <p className="text-12 text-text-muted">Mã: {list.error.error.traceId}</p>
        ) : null}
        <RetryAction onRetry={() => void list.refetch()} busy={list.isFetching} />
      </div>
    );
  if (!list.data.data.length)
    return (
      <div className="flex flex-col gap-2">
        <p>Workspace này chưa có kênh nào được kết nối.</p>
        <RetryAction onRetry={() => void list.refetch()} busy={list.isFetching} />
      </div>
    );
  return (
    <div className="overflow-x-auto rounded-card border border-border">
      <table className="w-full text-left">
        <caption className="sr-only">Kênh của workspace</caption>
        <thead className="bg-bg-subtle">
          <tr>
            {['Kênh', 'Loại', 'Trạng thái', 'Team trả lời'].map((t) => (
              <th key={t} scope="col" className="p-2 font-semibold">
                {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {list.data.data.map((c) => {
            const status = CHANNEL_STATUS[c.status];
            return (
              <tr key={c.id}>
                <td className="p-2">{c.displayName}</td>
                <td className="p-2">{CHANNEL_TYPE[c.type]}</td>
                <td className="p-2">
                  <span className={`rounded-input px-2 py-1 text-12 ${tone[status.tone]}`}>
                    {status.label}
                  </span>
                </td>
                <td className="p-2">{answeringTeam(c, teams.data?.data)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
