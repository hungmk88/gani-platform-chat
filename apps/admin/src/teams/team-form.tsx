'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { api } from '../api/client';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import {
  MAX_TEAM_DESCRIPTION,
  MAX_TEAM_NAME,
  teamDraftOf,
  teamError,
  withTeam,
  type Team,
  type TeamList,
} from './teams';

const field = 'rounded-input border border-border-strong px-3 py-2';

/**
 * "Tạo team" (#20, `POST /v1/teams`, N160) in the workspace being worked in: waits for the server (it makes a record), one
 * Idempotency-Key per name and description, kept when the same is sent again after a failure. The slug is the API's.
 */
export function TeamForm({ workspaceId }: { workspaceId: string }) {
  const scope = useScope();
  const queries = useQueryClient();
  const last = useRef<{ what: string; key: string } | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const create = useMutation<Team, ApiFailure, { body: object; key: string }>({
    mutationFn: ({ body, key }) =>
      unwrap(api<Team>('/v1/teams', { method: 'POST', body, idempotencyKey: key })),
    onSuccess: (team) => {
      last.current = null;
      queries.setQueryData<TeamList>(scopeKey(scope, 'teams', workspaceId), (l) =>
        withTeam(l, team),
      );
      setName('');
      setDescription('');
    },
  });

  const submit = () => {
    if (create.isPending) return;
    const body = teamDraftOf(workspaceId, name, description);
    if (typeof body === 'string') return setProblem(body);
    setProblem(null);
    const what = JSON.stringify(body);
    const key = last.current?.what === what ? last.current.key : crypto.randomUUID();
    last.current = { what, key };
    create.mutate({ body, key });
  };

  return (
    <form
      aria-labelledby="team-form-title"
      className="flex max-w-[480px] flex-col gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h2 id="team-form-title" className="text-16 font-semibold">
        Tạo team
      </h2>
      <label className="flex flex-col gap-1">
        Tên team
        <input
          value={name}
          maxLength={MAX_TEAM_NAME}
          aria-invalid={problem ? true : undefined}
          className={field}
          onChange={(e) => {
            setName(e.target.value);
            setProblem(null);
          }}
        />
      </label>
      <label className="flex flex-col gap-1">
        Mô tả (không bắt buộc)
        <textarea
          rows={2}
          value={description}
          maxLength={MAX_TEAM_DESCRIPTION}
          className="rounded-input border border-border-strong p-2"
          onChange={(e) => {
            setDescription(e.target.value);
            setProblem(null);
          }}
        />
      </label>
      {problem ? <p role="alert">{problem}</p> : null}
      {create.error ? (
        <div role="alert">
          <p>{teamError(create.error.error)}</p>
          {create.error.error.traceId ? (
            <p className="text-12 text-text-muted">Mã: {create.error.error.traceId}</p>
          ) : null}
        </div>
      ) : null}
      {create.isSuccess ? (
        <p role="status">
          Đã tạo team {create.data.name} (mã {create.data.slug}).
        </p>
      ) : null}
      <div>
        <button
          type="submit"
          className="rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70"
          disabled={create.isPending}
          aria-busy={create.isPending}
        >
          {create.isPending ? 'Đang tạo…' : 'Tạo team'}
        </button>
      </div>
    </form>
  );
}
