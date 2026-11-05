'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import { CHANNEL_TYPE } from '../channels/channels';
import { readListKey } from '../customer-data/catalog-screen';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import { dayText, MESSAGE_CLASS, POLICIES_PATH, type ChannelPolicy } from './platform';
import {
  changeOf,
  draftOf,
  policyPath,
  savedText,
  type ChannelPolicyChange,
  type PolicyDraft,
} from './policy-edit';

const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';
const field = 'rounded-input border border-border-strong px-3 py-2';
const UNKNOWN =
  'Chưa rõ đã lưu hay chưa. Nếu lưu lại mà báo ngày hiệu lực không hợp lệ, phiên bản đã được thêm.';

/**
 * #30 PR 30b (CEO 05/11, brief 86, tầng 2): "Thêm phiên bản" of one channel policy, the platform operator only. `PUT` the whole
 * policy from a later day, waiting for the server, no Idempotency-Key (the API refuses a day not later than the version in force,
 * 422 invalid_effective_from, so a second send cannot add twice). The form starts from the version in force; focus on the day.
 */
export function PolicyDialog({
  policy,
  onClose,
  onSaved,
}: {
  policy: ChannelPolicy;
  onClose: () => void;
  onSaved: (said: string) => void;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const day = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<PolicyDraft>(() => draftOf(policy));
  const [problem, setProblem] = useState<string | null>(null);
  const reread = () =>
    queries.invalidateQueries({ queryKey: scopeKey(scope, ...readListKey(POLICIES_PATH)) });
  const save = useMutation<ChannelPolicy, ApiFailure, ChannelPolicyChange>({
    mutationFn: (body) =>
      unwrap(api<ChannelPolicy>(policyPath(policy.id), { method: 'PUT', body })),
    onSuccess: (inForce, sent) => {
      void reread();
      onSaved(savedText(sent.effectiveFrom, inForce));
      dialog.current?.close();
    },
    onError: ({ error }) => {
      const unknown = error.code === 'network_error' || error.status >= 500;
      if (unknown || error.code === 'invalid_effective_from') void reread();
      setProblem(unknown ? UNKNOWN : error.message);
    },
  });
  useEffect(() => (dialog.current?.showModal(), day.current?.focus()), []);

  const set = (k: keyof PolicyDraft) => (v: string | boolean) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setProblem(null);
  };
  const text = (k: Exclude<keyof PolicyDraft, 'outside'>, label: string, type = 'text') => (
    <label className="flex flex-col gap-1">
      {label}
      <input
        ref={k === 'from' ? day : undefined}
        type={type}
        value={draft[k]}
        className={field}
        onChange={(e) => set(k)(e.target.value)}
      />
    </label>
  );
  const name = `${CHANNEL_TYPE[policy.channelType]} · ${MESSAGE_CLASS[policy.messageClass]}`;

  return (
    <dialog
      ref={dialog}
      aria-labelledby="policy-title"
      onClose={onClose}
      onCancel={(e) => save.isPending && e.preventDefault()}
      className="m-auto w-[520px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay"
    >
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (save.isPending) return;
          const body = changeOf(draft, policy);
          if (typeof body === 'string') return setProblem(body);
          save.mutate(body);
        }}
      >
        <h3 id="policy-title" className="text-16 font-semibold">
          Thêm phiên bản: {name}
        </h3>
        <p className="text-12 text-text-muted">
          Không sửa phiên bản cũ: phiên bản mới có hiệu lực từ 00:00 (giờ Việt Nam) của ngày chọn,
          sau {dayText(policy.effectiveFrom)}. Ghi audit.
        </p>
        {text('from', 'Hiệu lực từ (bắt buộc)', 'date')}
        {text('hours', 'Khung miễn phí (giờ, để trống nếu không có)')}
        {text('quota', 'Số tin miễn phí trong khung (để trống nếu không có)')}
        {text('price', 'Giá một tin ngoài phần miễn phí (đồng, để trống nếu chưa công bố)')}
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={draft.outside}
            onChange={(e) => set('outside')(e.target.checked)}
          />
          Được gửi ngoài khung miễn phí
        </label>
        {text('sourceUrl', 'Nguồn (link thông báo của nền tảng)')}
        {text('sourceDate', 'Ngày của nguồn', 'date')}
        <label className="flex flex-col gap-1">
          Ghi chú (bắt buộc)
          <textarea
            rows={2}
            value={draft.note}
            className={field}
            onChange={(e) => set('note')(e.target.value)}
          />
        </label>
        {problem ? (
          <div role="alert">
            <p>{problem}</p>
            {save.error?.error.traceId &&
            (problem === UNKNOWN || problem === save.error.error.message) ? (
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
            {save.isPending ? 'Đang lưu…' : 'Lưu phiên bản'}
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
