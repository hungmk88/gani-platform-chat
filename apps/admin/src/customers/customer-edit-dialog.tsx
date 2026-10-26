'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import {
  changeOf,
  customerEditError,
  draftOf,
  MAX_EMAIL,
  MAX_NAME,
  type Draft,
} from './customer-edit';
import { customerPath, nameOf, type Customer } from './customers';

const field = 'rounded-input border border-border-strong px-3 py-2';
const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';

/**
 * "Sửa hồ sơ khách" (#8, `PATCH /v1/customers/{id}`, N165): name, phone, email, "chỉ người phục vụ"; only what changed is sent,
 * a blank field clears it. Waits for the server; the profile then takes the API's answer and the lists are read again. Setting
 * values is idempotent, so no Idempotency-Key.
 */
export function CustomerEditDialog({
  customer,
  onClose,
  onDone,
}: {
  customer: Customer;
  onClose: () => void;
  onDone: (c: Customer) => void;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Draft>(() => draftOf(customer));
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation<Customer, ApiFailure, object>({
    mutationFn: (body) =>
      unwrap(api<Customer>(customerPath(customer.id), { method: 'PATCH', body })),
    onSuccess: (c) => {
      queries.setQueryData<Customer>(scopeKey(scope, 'customer', c.id), c);
      void queries.invalidateQueries({ queryKey: scopeKey(scope, 'customers') });
      onDone(c);
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
    const body = changeOf(customer, draft);
    if (typeof body === 'string') return setProblem(body);
    if (!Object.keys(body).length) return dialog.current?.close();
    save.mutate(body);
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="customer-edit-title"
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
        <h3 id="customer-edit-title" className="text-16 font-semibold">
          Sửa hồ sơ — {nameOf(customer)}
        </h3>
        <label className="flex flex-col gap-1">
          Tên khách (để trống là chưa có tên)
          <input
            value={draft.name}
            maxLength={MAX_NAME}
            className={field}
            onChange={(e) => edit({ name: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          SĐT (ví dụ 0912 345 678; để trống là xóa)
          <input
            type="tel"
            inputMode="tel"
            maxLength={32}
            value={draft.phone}
            className={field}
            onChange={(e) => edit({ phone: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          Email (để trống là xóa)
          <input
            type="email"
            maxLength={MAX_EMAIL}
            value={draft.email}
            className={field}
            onChange={(e) => edit({ email: e.target.value })}
          />
        </label>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={draft.humanOnly}
            onChange={(e) => edit({ humanOnly: e.target.checked })}
          />
          <span>Chỉ người phục vụ: bot không trả lời khách này</span>
        </label>
        <p className="text-12 text-text-muted">
          Nhật ký chỉ ghi tên trường đã đổi, không ghi giá trị.
        </p>
        {problem ? <p role="alert">{problem}</p> : null}
        {save.error ? (
          <div role="alert">
            <p>{customerEditError(save.error.error)}</p>
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
