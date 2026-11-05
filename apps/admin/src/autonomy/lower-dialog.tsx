'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import {
  autonomyPath,
  lowerChoices,
  lowerError,
  lowerReasonProblem,
  MAX_REASON,
  meaningOf,
  type Autonomy,
  type AutonomyChange,
  type Level,
} from './autonomy';

const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';
const danger =
  'rounded-input border border-error-text bg-error-bg px-4 py-2 font-semibold text-error-text disabled:opacity-70';

/**
 * "Hạ mức…" under the level of the workspace being worked in (#27 PR B, CEO 05/11, brief 61, tầng 3): greyed with a sentence when
 * no lower level can be chosen; once lowered, a status sentence takes the focus back.
 */
export function LowerLevel({ autonomy, workspace }: { autonomy: Autonomy; workspace: string }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Level | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const able = lowerChoices(autonomy).some((c) => c.why === null);
  return (
    <div className="flex flex-col items-start gap-2">
      <button
        ref={opener}
        type="button"
        className={button}
        disabled={!able}
        aria-describedby={able ? undefined : 'lower-hint'}
        onClick={() => {
          setDone(null);
          setOpen(true);
        }}
      >
        Hạ mức…
      </button>
      {able ? null : (
        <p id="lower-hint" className="text-12 text-text-muted">
          Đang ở mức thấp nhất chọn được.
        </p>
      )}
      {done ? (
        <p ref={status} role="status" tabIndex={-1}>
          Đã hạ về {done}. Đã ghi audit.
        </p>
      ) : null}
      {open ? (
        <LowerDialog
          autonomy={autonomy}
          workspace={workspace}
          onDone={setDone}
          onClose={(lowered) => {
            setOpen(false);
            // The button is greyed once at the lowest level: the status sentence takes the focus instead.
            requestAnimationFrame(() => (lowered ? status : opener).current?.focus());
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The dialog of two steps (no code to type, unlike erasing a customer's data: a lowered level can be raised again): choose the
 * level and write the reason, then confirm. `PATCH {level, reason}`, waiting for the server, no Idempotency-Key (a PATCH that
 * sets a value); the block then takes the API's answer. A refusal keeps the level and the reason chosen.
 */
function LowerDialog({
  autonomy,
  workspace,
  onDone,
  onClose,
}: {
  autonomy: Autonomy;
  workspace: string;
  onDone: (level: Level) => void;
  onClose: (lowered: boolean) => void;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const confirmTitle = useRef<HTMLHeadingElement>(null);
  const choices = lowerChoices(autonomy);
  const [level, setLevel] = useState<Level | undefined>(
    () => choices.filter((c) => c.why === null).at(-1)?.level,
  );
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const lowered = useRef(false);
  const lower = useMutation<Autonomy, ApiFailure, AutonomyChange>({
    mutationFn: (body) =>
      unwrap(api<Autonomy>(autonomyPath(scope.workspaceId ?? ''), { method: 'PATCH', body })),
    onSuccess: (a) => {
      queries.setQueryData(scopeKey(scope, 'autonomy', scope.workspaceId ?? ''), a);
      lowered.current = true;
      onDone(a.level);
      dialog.current?.close();
    },
  });
  useEffect(() => dialog.current?.showModal(), []);
  useEffect(() => {
    if (confirming) confirmTitle.current?.focus();
  }, [confirming]);

  const next = () => {
    const p = level ? lowerReasonProblem(reason) : 'Chọn mức mới.';
    setProblem(p);
    if (!p) setConfirming(true);
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="lower-title"
      onClose={() => onClose(lowered.current)}
      onCancel={(e) => {
        if (lower.isPending) e.preventDefault();
      }}
      className="m-auto w-[480px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay"
    >
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!confirming) next();
          else if (level && !lower.isPending) lower.mutate({ level, reason: reason.trim() });
        }}
      >
        <h3 id="lower-title" className="text-16 font-semibold">
          Hạ mức tự chủ — {workspace}
        </h3>
        {!confirming ? (
          <>
            <p>Đang ở: {autonomy.level}</p>
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1">Mức mới</legend>
              {choices.map((c) => (
                <label key={c.level} className="flex gap-2">
                  <input
                    type="radio"
                    name="level"
                    value={c.level}
                    checked={level === c.level}
                    disabled={c.why !== null}
                    onChange={() => setLevel(c.level)}
                  />
                  <span className={c.why ? 'text-text-muted' : undefined}>
                    {c.level} — {meaningOf(c.level)}
                    {c.why ? ` (${c.why})` : null}
                  </span>
                </label>
              ))}
            </fieldset>
            <label className="flex flex-col gap-1">
              Lý do (bắt buộc, ghi audit)
              <textarea
                rows={3}
                maxLength={MAX_REASON}
                value={reason}
                aria-invalid={problem ? true : undefined}
                aria-describedby="lower-reason-hint"
                className="rounded-input border border-border-strong p-2"
                onChange={(e) => {
                  setReason(e.target.value);
                  setProblem(null);
                }}
              />
            </label>
            <p id="lower-reason-hint" className="text-12 text-text-muted">
              {reason.length}/{MAX_REASON} ký tự. Không ghi SĐT, email, nội dung tin.
            </p>
            {problem ? <p role="alert">{problem}</p> : null}
            <div className="flex gap-2">
              <button type="submit" className={primary}>
                Tiếp tục
              </button>
              <button type="button" className={button} onClick={() => dialog.current?.close()}>
                Hủy
              </button>
            </div>
          </>
        ) : (
          <>
            <h4 ref={confirmTitle} tabIndex={-1} className="font-semibold">
              Xác nhận hạ mức
            </h4>
            <p>
              {workspace}: {autonomy.level} → {level}
            </p>
            <p className="whitespace-pre-wrap break-words">Lý do: {reason.trim()}</p>
            <p>Nâng lại chỉ Owner làm được.</p>
            {lower.error ? (
              <div role="alert">
                <p>{lowerError(lower.error.error)}</p>
                {lower.error.error.traceId ? (
                  <p className="text-12 text-text-muted">Mã: {lower.error.error.traceId}</p>
                ) : null}
              </div>
            ) : null}
            <div className="flex gap-2">
              <button
                type="submit"
                className={danger}
                disabled={lower.isPending}
                aria-busy={lower.isPending}
              >
                {lower.isPending ? 'Đang hạ mức…' : `Hạ xuống ${level}`}
              </button>
              <button
                type="button"
                className={button}
                disabled={lower.isPending}
                onClick={() => {
                  lower.reset();
                  setConfirming(false);
                  requestAnimationFrame(() =>
                    dialog.current?.querySelector<HTMLInputElement>('input:checked')?.focus(),
                  );
                }}
              >
                Quay lại
              </button>
            </div>
          </>
        )}
      </form>
    </dialog>
  );
}
