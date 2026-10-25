'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useApiQuery, useScope } from '../query/provider';
import { RetryAction } from '../retry-button';
import {
  answeredBy,
  CHANNEL_STATUS,
  CHANNEL_TYPE,
  channelsOf,
  channelsPath,
  sameChannels,
  teamChannelsError,
  teamChannelsPath,
  withAssigned,
  type ChannelList,
} from './team-channels';
import type { Team, TeamList } from './teams';

const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';

/**
 * "Kênh của team" (#20, `GET /v1/channels`, `PUT /v1/teams/{id}/channels`, N161): the channels of the workspace with a box each,
 * those the team answers ticked, the others saying who answers them. Saving sets the whole list: a ticked channel of another team
 * moves here, an unticked one of this team goes back to the default team. Waits for the server, no Idempotency-Key (a PUT).
 */
export function TeamChannelsDialog({
  team,
  onClose,
  onDone,
}: {
  team: Team;
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const channels = useApiQuery<ChannelList>(
    ['channels', team.workspaceId],
    channelsPath(team.workspaceId),
  );
  const teams = queries.getQueryData<TeamList>(scopeKey(scope, 'teams', team.workspaceId));
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const chosen = picked ?? channelsOf(channels.data?.data ?? [], team.id);
  const save = useMutation<Team, ApiFailure, string[]>({
    mutationFn: (channelIds) =>
      unwrap(api<Team>(teamChannelsPath(team.id), { method: 'PUT', body: { channelIds } })),
    onSuccess: (_, channelIds) => {
      queries.setQueryData<ChannelList>(scopeKey(scope, 'channels', team.workspaceId), (l) =>
        withAssigned(l, team.id, channelIds),
      );
      onDone(channelIds.length);
      dialog.current?.close();
    },
  });
  useEffect(() => dialog.current?.showModal(), []);

  const toggle = (id: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };
  const submit = () => {
    if (save.isPending || !channels.data) return;
    if (sameChannels(chosen, channels.data.data, team.id)) return dialog.current?.close();
    save.mutate([...chosen]);
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="team-channels-title"
      onClose={onClose}
      className="m-auto w-[520px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay"
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h3 id="team-channels-title" className="text-16 font-semibold">
          Kênh của team — {team.name}
        </h3>
        {channels.isPending ? (
          <p role="status" aria-busy="true" className="text-text-muted">
            Đang tải kênh…
          </p>
        ) : channels.isError ? (
          <div role="alert" className="flex flex-col gap-2">
            <p>{channels.error.error.message}</p>
            {channels.error.error.traceId ? (
              <p className="text-12 text-text-muted">Mã: {channels.error.error.traceId}</p>
            ) : null}
            <RetryAction onRetry={() => void channels.refetch()} busy={channels.isFetching} />
          </div>
        ) : channels.data.data.length === 0 ? (
          <p>Workspace này chưa có kênh nào được kết nối.</p>
        ) : (
          <fieldset className="flex max-h-[360px] flex-col gap-1 overflow-y-auto">
            <legend className="pb-2">
              Team này trả lời {chosen.size} / {channels.data.data.length} kênh. Chọn kênh của team
              khác là chuyển sang team này; bỏ chọn là trả về team mặc định.
            </legend>
            {channels.data.data.map((c) => {
              const other = answeredBy(c, team.id, teams?.data ?? []);
              return (
                <label key={c.id} className="flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    checked={chosen.has(c.id)}
                    onChange={(e) => toggle(c.id, e.target.checked)}
                  />
                  <span>
                    {c.displayName} · {CHANNEL_TYPE[c.type]}
                    <span className="block text-12 text-text-muted">
                      {CHANNEL_STATUS[c.status]}
                      {other ? ` · Đang do ${other} trả lời` : null}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}
        {save.error ? (
          <div role="alert">
            <p>{teamChannelsError(save.error.error)}</p>
            {save.error.error.traceId ? (
              <p className="text-12 text-text-muted">Mã: {save.error.error.traceId}</p>
            ) : null}
          </div>
        ) : null}
        <div className="flex gap-2">
          <button
            type="submit"
            className={primary}
            disabled={save.isPending || !channels.data}
            aria-busy={save.isPending}
          >
            {save.isPending ? 'Đang lưu…' : 'Lưu kênh của team'}
          </button>
          <button type="button" className={button} onClick={() => dialog.current?.close()}>
            Hủy
          </button>
        </div>
      </form>
    </dialog>
  );
}
