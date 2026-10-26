'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../api/client';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import {
  changeOf,
  draftOf,
  MAX_LIMIT,
  MAX_NAME,
  TEMPLATE,
  timeZones,
  withWorkspace,
  workspaceError,
  type Draft,
  type Workspace,
  type WorkspaceList,
} from './workspace';

const field = 'rounded-input border border-border-strong px-3 py-2';
const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';

/**
 * "Sửa workspace" (#21, `PATCH /v1/workspaces/{id}`, N157): name, time zone, default load limit, contact number (N163); only what
 * changed is sent. Waits
 * for the server; the list then takes the API's answer and the frame is read again (its header shows the workspace's name).
 * Setting values is idempotent, so no Idempotency-Key (N157).
 */
export function WorkspaceDialog({
  workspace,
  onClose,
  onDone,
}: {
  workspace: Workspace;
  onClose: () => void;
  onDone: (w: Workspace) => void;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Draft>(() => draftOf(workspace));
  const [problem, setProblem] = useState<string | null>(null);
  const zones = useMemo(() => timeZones(workspace.timezone), [workspace.timezone]);
  const save = useMutation<Workspace, ApiFailure, object>({
    mutationFn: (body) =>
      unwrap(
        api<Workspace>(`/v1/workspaces/${encodeURIComponent(workspace.id)}`, {
          method: 'PATCH',
          body,
        }),
      ),
    onSuccess: (w) => {
      queries.setQueryData<WorkspaceList>(scopeKey(scope, 'workspaces'), (l) =>
        withWorkspace(l, w),
      );
      router.refresh();
      onDone(w);
      dialog.current?.close();
    },
  });
  useEffect(() => dialog.current?.showModal(), []);

  const edit = (next: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...next }));
    setProblem(null);
  };
  const submit = () => {
    if (save.isPending) return;
    const body = changeOf(workspace, draft);
    if (typeof body === 'string') return setProblem(body);
    if (!Object.keys(body).length) return dialog.current?.close();
    save.mutate(body);
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="workspace-title"
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
        <h3 id="workspace-title" className="text-16 font-semibold">
          Sửa workspace — {workspace.name}
        </h3>
        <label className="flex flex-col gap-1">
          Tên workspace
          <input
            value={draft.name}
            maxLength={MAX_NAME}
            className={field}
            onChange={(e) => edit({ name: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          Múi giờ
          <select
            value={draft.timezone}
            className={field}
            onChange={(e) => edit({ timezone: e.target.value })}
          >
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Giới hạn tải mặc định (hội thoại mỗi người, 1–{MAX_LIMIT})
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_LIMIT}
            step={1}
            value={draft.limit}
            className={field}
            onChange={(e) => edit({ limit: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          SĐT liên hệ (thay cho biến SĐT công ty trong mẫu trả lời; để trống là không có)
          <input
            type="tel"
            inputMode="tel"
            maxLength={20}
            value={draft.phone}
            className={field}
            onChange={(e) => edit({ phone: e.target.value })}
          />
        </label>
        <p className="text-12 text-text-muted">
          Mẫu {TEMPLATE[workspace.template]} và mã {workspace.slug} chọn lúc tạo, không đổi ở đây.
          Giới hạn riêng từng người sửa ở Cài đặt › Thành viên.
        </p>
        {problem ? <p role="alert">{problem}</p> : null}
        {save.error ? (
          <div role="alert">
            <p>{workspaceError(save.error.error)}</p>
            {save.error.error.traceId ? (
              <p className="text-12 text-text-muted">Mã: {save.error.error.traceId}</p>
            ) : null}
          </div>
        ) : null}
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
