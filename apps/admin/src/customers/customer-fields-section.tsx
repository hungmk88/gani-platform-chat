'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import { FIELDS_PATH, type CustomerField } from '../customer-data/catalog';
import { readListKey } from '../customer-data/catalog-screen';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useApiQuery, useScope } from '../query/provider';
import { RetryAction } from '../retry-button';
import {
  changesOf,
  draftOf,
  fieldRows,
  fieldsFailureOf,
  fieldsPath,
  MAX_TEXT,
  valueText,
  type Draft,
  type FieldValues,
} from './customer-fields';

const box = 'rounded-input border border-border-strong px-3 py-2';
const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';
const INPUT = { text: 'text', number: 'text', date: 'date', phone: 'tel', email: 'email' } as const;

/**
 * "Thông tin thêm" of #8 (J1, N191; CEO brief 169 P2b-1, P2b-2): the company's fields (`GET /v1/customer-fields`, the cache of #23) with
 * this customer's values (`GET …/fields`), by position; a hidden field only when it has a value. The roles of "Sửa hồ sơ khách"
 * (`editable`) change the fields in use in a dialog that waits for the server (`PUT`, only what changed, blank clears).
 */
export function CustomerFieldsSection({ id, editable }: { id: string; editable: boolean }) {
  const fields = useApiQuery<{ readonly data: readonly CustomerField[] }>(
    readListKey(FIELDS_PATH),
    FIELDS_PATH,
  );
  const values = useApiQuery<FieldValues>(['customer', id, 'fields'], fieldsPath(id));
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const failed = fields.isError ? fields : values.isError ? values : null;
  return (
    <section aria-labelledby="customer-fields" className="flex flex-col gap-2">
      <h2 id="customer-fields" className="text-16 font-semibold">
        Thông tin thêm
      </h2>
      {failed ? (
        <div role="alert" className="flex flex-col gap-2">
          <p>{failed.error.error.message}</p>
          {failed.error.error.traceId ? (
            <p className="text-12 text-text-muted">Mã: {failed.error.error.traceId}</p>
          ) : null}
          <RetryAction onRetry={() => void failed.refetch()} busy={failed.isFetching} />
        </div>
      ) : !fields.isSuccess || !values.isSuccess ? (
        <p role="status" aria-busy="true" className="text-text-muted">
          Đang tải thông tin thêm…
        </p>
      ) : fields.data.data.length === 0 ? (
        <p>Công ty chưa có trường tùy chỉnh. Owner hoặc Admin thêm ở Cài đặt › Dữ liệu khách.</p>
      ) : (
        <>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2">
            {fieldRows(fields.data.data, values.data.data).map(({ field, value }) => (
              <div key={field.id} className="contents">
                <dt className="text-text-muted">
                  {field.name}
                  {field.hidden ? ' (đã ẩn)' : null}
                </dt>
                <dd className="whitespace-pre-wrap break-words">{valueText(field, value)}</dd>
              </div>
            ))}
          </dl>
          {saved ? <p role="status">Đã lưu thông tin thêm.</p> : null}
          {editable ? (
            <button
              type="button"
              className={`self-start ${button}`}
              onClick={() => {
                setSaved(false);
                setEditing(true);
              }}
            >
              Sửa thông tin thêm
            </button>
          ) : null}
          {editing ? (
            <FieldsDialog
              id={id}
              fields={fields.data.data.filter((f) => !f.hidden)}
              values={values.data.data}
              onClose={() => setEditing(false)}
              onDone={() => setSaved(true)}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

function FieldsDialog(p: {
  id: string;
  fields: readonly CustomerField[];
  values: FieldValues['data'];
  onClose: () => void;
  onDone: () => void;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const [before] = useState<Draft>(() => draftOf(p.fields, p.values));
  const [draft, setDraft] = useState<Draft>(before);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation<FieldValues, ApiFailure, object>({
    mutationFn: (body) => unwrap(api<FieldValues>(fieldsPath(p.id), { method: 'PUT', body })),
    onSuccess: (answer) => {
      queries.setQueryData(scopeKey(scope, 'customer', p.id, 'fields'), answer);
      void queries.invalidateQueries({ queryKey: scopeKey(scope, ...readListKey(FIELDS_PATH)) });
      p.onDone();
      dialog.current?.close();
    },
    onError: ({ error }) => {
      if (!fieldsFailureOf(error).again) return;
      void queries.invalidateQueries({ queryKey: scopeKey(scope, ...readListKey(FIELDS_PATH)) });
      void queries.invalidateQueries({ queryKey: scopeKey(scope, 'customer', p.id, 'fields') });
    },
  });
  useEffect(() => dialog.current?.showModal(), []);

  const edit = (fieldId: string, value: string | readonly string[]) => {
    setDraft((d) => ({ ...d, [fieldId]: value }));
    setProblem(null);
  };
  const submit = () => {
    if (save.isPending) return;
    const body = changesOf(p.fields, before, draft);
    if (typeof body === 'string') return setProblem(body);
    if (!body) return dialog.current?.close();
    save.mutate(body);
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="fields-edit-title"
      onClose={p.onClose}
      onCancel={(e) => save.isPending && e.preventDefault()}
      className="m-auto w-[480px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay"
    >
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h3 id="fields-edit-title" className="text-16 font-semibold">
          Sửa thông tin thêm
        </h3>
        {p.fields.map((f) => {
          const value = draft[f.id] ?? '';
          const label = `${f.name}${f.required ? ' (nên điền)' : ''}`;
          if (f.type === 'multiselect')
            return (
              <fieldset key={f.id} className="flex flex-col gap-1">
                <legend>{label}</legend>
                {f.options.map((o) => (
                  <label key={o} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={(value as readonly string[]).includes(o)}
                      onChange={(e) => {
                        const now = value as readonly string[];
                        edit(f.id, e.target.checked ? [...now, o] : now.filter((x) => x !== o));
                      }}
                    />
                    {o}
                  </label>
                ))}
              </fieldset>
            );
          return (
            <label key={f.id} className="flex flex-col gap-1">
              {label}
              {f.type === 'select' ? (
                <select
                  value={value}
                  className={box}
                  onChange={(e) => edit(f.id, e.target.value)}
                >
                  <option value="">Chưa chọn</option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={INPUT[f.type]}
                  inputMode={f.type === 'number' ? 'decimal' : undefined}
                  maxLength={f.type === 'text' ? MAX_TEXT : undefined}
                  value={value}
                  className={box}
                  onChange={(e) => edit(f.id, e.target.value)}
                />
              )}
            </label>
          );
        })}
        <p className="text-12 text-text-muted">
          Để trống là xóa giá trị. Nhật ký chỉ ghi trường đã đổi.
        </p>
        {problem ? <p role="alert">{problem}</p> : null}
        {save.error ? (
          <div role="alert">
            <p>{fieldsFailureOf(save.error.error).text}</p>
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
