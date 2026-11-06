'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  AGENT_STATUS,
  AGENT_STATUS_KEY,
  AGENT_STATUS_PATH,
  stripOf,
  type AgentStatus,
  type AgentStatusValue,
} from './agent-status';
import { api } from './api/client';
import { ApiFailure, unwrap } from './query/fetch';
import { scopeKey } from './query/keys';
import { useApiQuery, useScope } from './query/provider';

const button = 'rounded-input border border-border-strong px-3 py-1';

/** The status of the signed-in agent, read once for the picker and the line (one cache key). */
const useAgentStatus = () => useApiQuery<AgentStatus>(AGENT_STATUS_KEY, AGENT_STATUS_PATH);

/** `PUT {status}`, waiting for the server (a status is set, not created: no Idempotency-Key); the answer is the new cache. */
function useSetStatus() {
  const scope = useScope();
  const queries = useQueryClient();
  return useMutation<AgentStatus, ApiFailure, AgentStatusValue>({
    mutationFn: (status) =>
      unwrap(api<AgentStatus>(AGENT_STATUS_PATH, { method: 'PUT', body: { status } })),
    onSuccess: (s) => queries.setQueryData(scopeKey(scope, ...AGENT_STATUS_KEY), s),
  });
}

/**
 * "Trạng thái của tôi" in the top bar (U82, tầng 2): Online, Bận or Offline. While it loads the choice is greyed; a 404 (the API
 * does not serve it yet, planned S4) shows nothing; a failure to read says so with "Thử lại". A change waits for the server: the
 * choice keeps the old status until it answers, and a refusal says why with its trace and "Thử lại" (the same status again).
 */
export function AgentStatusPicker() {
  const status = useAgentStatus();
  const set = useSetStatus();
  const [wanted, setWanted] = useState<AgentStatusValue | null>(null);
  if (status.isError && status.error.error.code === 'not_found') return null;
  if (status.isError)
    return (
      <span role="alert" className="flex items-center gap-2 text-12">
        Không đọc được trạng thái.
        <button type="button" className={button} onClick={() => void status.refetch()}>
          Thử lại
        </button>
      </span>
    );
  const change = (s: AgentStatusValue) => (setWanted(s), set.mutate(s));
  const failure = set.error?.error;
  return (
    <span className="flex items-center gap-2">
      <label className="flex items-center gap-2">
        Trạng thái của tôi
        <select
          value={status.data?.status ?? ''}
          disabled={status.isPending || set.isPending}
          aria-busy={status.isPending || set.isPending}
          className="rounded-input border border-border-strong px-2 py-1"
          onChange={(e) => change(e.target.value as AgentStatusValue)}
        >
          {status.isPending ? <option value="">Đang tải…</option> : null}
          {(Object.keys(AGENT_STATUS) as AgentStatusValue[]).map((s) => (
            <option key={s} value={s}>
              {AGENT_STATUS[s]}
            </option>
          ))}
        </select>
      </label>
      {failure && wanted ? (
        <span role="alert" className="flex items-center gap-2 text-12">
          {failure.message}
          {failure.traceId ? <span className="text-text-muted">Mã: {failure.traceId}</span> : null}
          <button type="button" className={button} onClick={() => set.mutate(wanted)}>
            Thử lại
          </button>
        </span>
      ) : null}
    </span>
  );
}

/** The line under the top bar when the API set Offline because the connection was lost (`reason: disconnected`), with "Online". */
export function AgentStatusStrip() {
  const status = useAgentStatus();
  const set = useSetStatus();
  const text = status.data ? stripOf(status.data) : null;
  if (!text) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-2 border-b border-border bg-bg-subtle px-4 py-2"
    >
      <p>{text}</p>
      <button
        type="button"
        className={button}
        disabled={set.isPending}
        aria-busy={set.isPending}
        onClick={() => set.mutate('online')}
      >
        Online
      </button>
    </div>
  );
}
