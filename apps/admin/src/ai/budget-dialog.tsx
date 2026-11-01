'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import {
  budgetStop,
  budgetValue,
  MAX_BUDGET,
  settingsPath,
  usdText,
  type AiSettings,
} from './settings';

const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';
const UNKNOWN = 'Chưa rõ đã lưu hay chưa. Màn đã đọc lại ngân sách hiện tại; lưu lại nếu cần.';

/**
 * B1b (CEO 01/11): the monthly budget of the workspace, `PATCH …/ai-settings {monthlyBudgetUsd}`, waiting for the server. Checked as
 * the API checks it; unchanged closes without a call. A budget at or under what was spent stops the internal AI now, and 0 turns it
 * off: the dialog says so and the button says it too. Setting a value is idempotent: no Idempotency-Key.
 */
export function BudgetDialog({
  settings,
  reset,
  onClose,
}: {
  settings: AiSettings;
  reset: string;
  onClose: () => void;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const key = scopeKey(scope, 'ai', 'settings', scope.workspaceId ?? '');
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(String(settings.monthlyBudgetUsd));
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation<AiSettings, ApiFailure, number>({
    mutationFn: (budget) =>
      unwrap(
        api<AiSettings>(settingsPath(scope.workspaceId ?? ''), {
          method: 'PATCH',
          body: { monthlyBudgetUsd: budget },
        }),
      ),
    onSuccess: (s) => {
      queries.setQueryData(key, s);
      dialog.current?.close();
    },
    onError: ({ error }) => {
      const unknown = error.code === 'network_error' || error.status >= 500;
      if (unknown) void queries.invalidateQueries({ queryKey: key, exact: true });
      setProblem(unknown ? UNKNOWN : error.message);
    },
  });
  useEffect(() => dialog.current?.showModal(), []);

  const typed = budgetValue(value);
  const stop =
    typeof typed === 'number' ? budgetStop(typed, settings.usedThisMonthUsd, reset) : null;
  const submit = () => {
    if (save.isPending) return;
    if (typeof typed === 'string') return setProblem(typed);
    if (typed === settings.monthlyBudgetUsd) return dialog.current?.close();
    save.mutate(typed);
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="budget-title"
      onClose={onClose}
      className="m-auto w-[440px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay"
    >
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h3 id="budget-title" className="text-16 font-semibold">
          Ngân sách tháng
        </h3>
        <label className="flex flex-col gap-1">
          Ngân sách tháng (USD, 0–1.000.000)
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={MAX_BUDGET}
            step={0.01}
            value={value}
            aria-invalid={problem && typeof typed === 'string' ? true : undefined}
            className="rounded-input border border-border-strong px-3 py-2"
            onChange={(e) => {
              setValue(e.target.value);
              setProblem(null);
            }}
          />
        </label>
        <p className="text-12 text-text-muted">
          Đã dùng tháng này: {usdText(settings.usedThisMonthUsd)}. Đặt lại lúc {reset}.
        </p>
        {stop ? (
          <p role="status" className="rounded-input bg-error-bg px-2 py-1 text-error-text">
            {stop}
          </p>
        ) : null}
        {problem ? <p role="alert">{problem}</p> : null}
        <div className="flex gap-2">
          <button
            type="submit"
            className={primary}
            disabled={save.isPending}
            aria-busy={save.isPending}
          >
            {save.isPending ? 'Đang lưu…' : stop ? 'Lưu, AI nội bộ dừng ngay' : 'Lưu ngân sách'}
          </button>
          <button
            type="button"
            className={button}
            disabled={save.isPending}
            onClick={() => dialog.current?.close()}
          >
            Hủy
          </button>
        </div>
      </form>
    </dialog>
  );
}
