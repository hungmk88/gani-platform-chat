'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import {
  featureBody,
  mayTurn,
  PRODUCTION_LOCK,
  settingsPath,
  type AiSettings,
  type FeatureKey,
} from './settings';

const button =
  'rounded-input border border-border-strong px-3 py-1 disabled:opacity-70 aria-disabled:opacity-70';
const UNKNOWN = 'Chưa rõ đã lưu hay chưa. Màn đã đọc lại trạng thái hiện tại; bấm lại nếu cần.';

/**
 * B1a: one feature turned on or off (`PATCH …/ai-settings` with that feature only), waiting for the server. Both ways go through one
 * handler that reads the settings again right before sending (CEO 01/11): the environment may have changed since the screen read it,
 * and turning on is never sent in `production` (`mayTurn`), whatever the button showed.
 */
export function FeatureToggle({
  feature,
  name,
  settings,
  lockId,
}: {
  feature: FeatureKey;
  name: string;
  settings: AiSettings;
  lockId: string;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const path = settingsPath(scope.workspaceId ?? '');
  const key = scopeKey(scope, 'ai', 'settings', scope.workspaceId ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const on = !settings.features[feature];
  const allowed = mayTurn(settings.environment, on);
  const turn = useMutation<AiSettings | null, ApiFailure, void>({
    mutationFn: async () => {
      const fresh = await unwrap(api<AiSettings>(path));
      queries.setQueryData(key, fresh);
      if (!mayTurn(fresh.environment, on)) return null;
      return unwrap(api<AiSettings>(path, { method: 'PATCH', body: featureBody(feature, on) }));
    },
    onSuccess: (s) => {
      if (s) queries.setQueryData(key, s);
      setProblem(s ? null : PRODUCTION_LOCK);
    },
    onError: ({ error }) => {
      const unknown = error.code === 'network_error' || error.status >= 500;
      if (unknown) void queries.invalidateQueries({ queryKey: key, exact: true });
      setProblem(unknown ? UNKNOWN : error.message);
    },
  });
  const click = () => {
    if (!allowed || turn.isPending) return; // aria-disabled does not stop a click
    setProblem(null);
    turn.mutate();
  };
  return (
    <>
      <button
        type="button"
        className={button}
        aria-label={`${on ? 'Bật' : 'Tắt'} ${name}`}
        aria-disabled={!allowed}
        aria-describedby={allowed ? undefined : lockId}
        title={allowed ? undefined : PRODUCTION_LOCK}
        disabled={turn.isPending}
        aria-busy={turn.isPending}
        onClick={click}
      >
        {turn.isPending ? 'Đang lưu…' : on ? 'Bật' : 'Tắt'}
      </button>
      {problem ? (
        <span role="alert" className="text-error-text">
          {problem}
        </span>
      ) : null}
    </>
  );
}
