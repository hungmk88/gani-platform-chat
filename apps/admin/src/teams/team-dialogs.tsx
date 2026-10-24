'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import {
  MAX_TEAM_DESCRIPTION,
  MAX_TEAM_NAME,
  teamChangeOf,
  teamDraftFrom,
  teamError,
  withChanged,
  withoutTeam,
  type Team,
  type TeamDraft,
  type TeamList,
} from './teams';

const field = 'rounded-input border border-border-strong px-3 py-2';
const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';
const dialogClass =
  'm-auto w-[440px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay';

function ErrorOf({ failure }: { failure: ApiFailure | null }) {
  if (!failure) return null;
  return (
    <div role="alert">
      <p>{teamError(failure.error)}</p>
      {failure.error.traceId ? (
        <p className="text-12 text-text-muted">Mã: {failure.error.traceId}</p>
      ) : null}
    </div>
  );
}

/**
 * "Sửa team" (#20, `PATCH /v1/teams/{id}`, N160): name, description, and making it the default team of the workspace; only what
 * changed is sent. Waits for the server, no Idempotency-Key (it sets values); the list then takes the API's answer.
 */
export function TeamDialog({
  team,
  onClose,
  onDone,
}: {
  team: Team;
  onClose: () => void;
  onDone: (t: Team) => void;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<TeamDraft>(() => teamDraftFrom(team));
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation<Team, ApiFailure, object>({
    mutationFn: (body) =>
      unwrap(api<Team>(`/v1/teams/${encodeURIComponent(team.id)}`, { method: 'PATCH', body })),
    onSuccess: (t) => {
      queries.setQueryData<TeamList>(scopeKey(scope, 'teams', team.workspaceId), (l) =>
        withChanged(l, t),
      );
      onDone(t);
      dialog.current?.close();
    },
  });
  useEffect(() => dialog.current?.showModal(), []);

  const edit = (next: Partial<TeamDraft>) => {
    setDraft((d) => ({ ...d, ...next }));
    setProblem(null);
  };
  const submit = () => {
    if (save.isPending) return;
    const body = teamChangeOf(team, draft);
    if (typeof body === 'string') return setProblem(body);
    if (!Object.keys(body).length) return dialog.current?.close();
    save.mutate(body);
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="team-edit-title"
      onClose={onClose}
      className={dialogClass}
    >
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h3 id="team-edit-title" className="text-16 font-semibold">
          Sửa team — {team.name}
        </h3>
        <label className="flex flex-col gap-1">
          Tên team
          <input
            value={draft.name}
            maxLength={MAX_TEAM_NAME}
            className={field}
            onChange={(e) => edit({ name: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          Mô tả (không bắt buộc)
          <textarea
            rows={2}
            value={draft.description}
            maxLength={MAX_TEAM_DESCRIPTION}
            className="rounded-input border border-border-strong p-2"
            onChange={(e) => edit({ description: e.target.value })}
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.isDefault}
            disabled={team.isDefault}
            onChange={(e) => edit({ isDefault: e.target.checked })}
          />
          Team mặc định của workspace (nhận hội thoại không có quy tắc nào khác)
        </label>
        <p className="text-12 text-text-muted">
          {team.isDefault
            ? 'Muốn đổi team mặc định, đặt team khác làm mặc định.'
            : 'Đặt làm mặc định thì team mặc định cũ thôi là mặc định.'}{' '}
          Mã {team.slug} không đổi.
        </p>
        {problem ? <p role="alert">{problem}</p> : null}
        <ErrorOf failure={save.error} />
        <div className="flex gap-2">
          <button
            type="submit"
            className={primary}
            disabled={save.isPending}
            aria-busy={save.isPending}
          >
            {save.isPending ? 'Đang lưu…' : 'Lưu'}
          </button>
          <button type="button" className={button} onClick={() => dialog.current?.close()}>
            Hủy
          </button>
        </div>
      </form>
    </dialog>
  );
}

/**
 * "Kết thúc team" (#20, `DELETE /v1/teams/{id}`, N160): asked once more, waits for the server; its people leave it and it leaves the
 * list. The default team of a workspace stays (409 team_in_use).
 */
export function EndTeamDialog({
  team,
  onClose,
  onDone,
}: {
  team: Team;
  onClose: () => void;
  onDone: (t: Team) => void;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const end = useMutation<null, ApiFailure, void>({
    mutationFn: () =>
      unwrap(api<null>(`/v1/teams/${encodeURIComponent(team.id)}`, { method: 'DELETE' })),
    onSuccess: () => {
      queries.setQueryData<TeamList>(scopeKey(scope, 'teams', team.workspaceId), (l) =>
        withoutTeam(l, team.id),
      );
      onDone(team);
      dialog.current?.close();
    },
  });
  useEffect(() => dialog.current?.showModal(), []);

  return (
    <dialog ref={dialog} aria-labelledby="team-end-title" onClose={onClose} className={dialogClass}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!end.isPending) end.mutate();
        }}
      >
        <h3 id="team-end-title" className="text-16 font-semibold">
          Kết thúc team {team.name}?
        </h3>
        <p>
          {team.memberCount} người rời team này. Team không còn trong danh sách và không mở lại
          được.
        </p>
        <ErrorOf failure={end.error} />
        <div className="flex gap-2">
          <button
            type="submit"
            className={primary}
            disabled={end.isPending}
            aria-busy={end.isPending}
          >
            {end.isPending ? 'Đang kết thúc…' : 'Kết thúc team'}
          </button>
          <button type="button" className={button} onClick={() => dialog.current?.close()}>
            Hủy
          </button>
        </div>
      </form>
    </dialog>
  );
}
