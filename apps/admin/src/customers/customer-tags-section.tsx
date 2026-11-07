'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import { readListKey } from '../customer-data/catalog-screen';
import { TAGS_PATH, type Tag } from '../customer-data/catalog';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useApiQuery, useScope } from '../query/provider';
import { RetryAction } from '../retry-button';
import type { Customer } from './customers';
import {
  chosenTags,
  tagChoices,
  tagFailureOf,
  tagsPath,
  type CustomerTag,
  type CustomerTagList,
} from './customer-tags';

const chip = 'rounded-input border border-border px-2 py-1 text-12';

/**
 * "Tag" of #8 (J4, N190; CEO brief 169 P2a): the customer's tags for every role; "Sửa tag" for the roles of "Sửa hồ sơ khách"
 * (`editable`) opens the company's tags (`GET /v1/tags`, the cache of #23) as boxes to tick. Saving is optimistic (CLAUDE.md): the
 * profile shows the new set at once, `PUT …/tags` (the whole set, no Idempotency-Key) answers it; a refusal puts the old set back
 * and opens the boxes again with what was ticked.
 */
export function CustomerTagsSection({
  customer,
  editable,
}: {
  customer: Customer;
  editable: boolean;
}) {
  const scope = useScope();
  const queries = useQueryClient();
  const opener = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string> | null>(null); // null: not editing
  const [failure, setFailure] = useState<{ text: string; traceId: string | null } | null>(null);
  const customerKey = scopeKey(scope, 'customer', customer.id);
  const all = useApiQuery<{ readonly data: readonly Tag[] }>(
    readListKey(TAGS_PATH),
    TAGS_PATH,
    ticked !== null,
  );
  const choices = tagChoices(all.data?.data ?? [], customer.tags);
  const editing = ticked !== null;
  // Opened: the boxes take the focus; opened again by a refusal: its sentence does.
  useEffect(() => {
    if (editing) (alert.current ?? form.current)?.focus();
  }, [editing]);

  const save = useMutation<
    CustomerTagList,
    ApiFailure,
    { tags: CustomerTag[]; before: CustomerTag[]; ids: ReadonlySet<string> }
  >({
    mutationFn: ({ tags }) =>
      unwrap(
        api<CustomerTagList>(tagsPath(customer.id), {
          method: 'PUT',
          body: { tagIds: tags.map((t) => t.id) },
        }),
      ),
    onMutate: ({ tags }) => {
      setFailure(null);
      setTicked(null);
      queries.setQueryData<Customer>(customerKey, (c) => (c ? { ...c, tags } : c));
    },
    onSuccess: (answer) => {
      queries.setQueryData<Customer>(customerKey, (c) => (c ? { ...c, tags: answer.data } : c));
      void queries.invalidateQueries({ queryKey: scopeKey(scope, 'customers') });
      void queries.invalidateQueries({ queryKey: scopeKey(scope, ...readListKey(TAGS_PATH)) });
    },
    onError: ({ error }, { before, ids }) => {
      queries.setQueryData<Customer>(customerKey, (c) => (c ? { ...c, tags: before } : c));
      const { text, again } = tagFailureOf(error);
      setFailure({ text, traceId: error.traceId });
      setTicked(ids);
      if (again) {
        void queries.invalidateQueries({ queryKey: scopeKey(scope, ...readListKey(TAGS_PATH)) });
        void queries.invalidateQueries({ queryKey: customerKey, exact: true });
      }
    },
  });

  const close = () => {
    setTicked(null);
    setFailure(null);
    requestAnimationFrame(() => opener.current?.focus());
  };
  const submit = () => {
    if (!ticked) return;
    const tags = chosenTags(choices, ticked);
    const same =
      tags.length === customer.tags.length && customer.tags.every((t) => ticked.has(t.id));
    if (same) return close();
    save.mutate({ tags, before: customer.tags, ids: ticked });
    requestAnimationFrame(() => opener.current?.focus());
  };

  return (
    <section aria-labelledby="customer-tags" className="flex flex-col gap-2">
      <h2 id="customer-tags" className="text-16 font-semibold">
        Tag
      </h2>
      {customer.tags.length ? (
        <ul aria-label="Tag của khách" className="flex flex-wrap gap-2">
          {customer.tags.map((t) => (
            <li key={t.id} className={chip}>
              {t.name}
              {t.hidden ? ' (đã ẩn)' : null}
            </li>
          ))}
        </ul>
      ) : (
        <p>Khách chưa có tag nào.</p>
      )}
      {save.isPending ? (
        <p role="status" className="text-12 text-text-muted">
          Đang lưu tag…
        </p>
      ) : null}
      {editable && !ticked ? (
        <button
          ref={opener}
          type="button"
          className="self-start rounded-input border border-border-strong px-3 py-1"
          onClick={() => {
            setFailure(null);
            setTicked(new Set(customer.tags.map((t) => t.id)));
          }}
        >
          Sửa tag
        </button>
      ) : null}
      {editable && ticked ? (
        <form
          ref={form}
          tabIndex={-1}
          aria-label="Sửa tag"
          className="flex flex-col gap-2 rounded-input border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {all.isPending ? (
            <p role="status" aria-busy="true" className="text-text-muted">
              Đang tải danh sách tag…
            </p>
          ) : all.isError ? (
            <div role="alert" className="flex flex-col gap-2">
              <p>{all.error.error.message}</p>
              {all.error.error.traceId ? (
                <p className="text-12 text-text-muted">Mã: {all.error.error.traceId}</p>
              ) : null}
              <RetryAction onRetry={() => void all.refetch()} busy={all.isFetching} />
            </div>
          ) : choices.length ? (
            <fieldset className="flex flex-col gap-1">
              <legend className="text-12 text-text-muted">
                Chọn tag cho khách. Tag đã ẩn bỏ ra thì không gắn lại được.
              </legend>
              {choices.map((t) => (
                <label key={t.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={ticked.has(t.id)}
                    onChange={(e) => {
                      const next = new Set(ticked);
                      if (e.target.checked) next.add(t.id);
                      else next.delete(t.id);
                      setTicked(next);
                    }}
                  />
                  {t.name}
                  {t.hidden ? ' (đã ẩn)' : null}
                </label>
              ))}
            </fieldset>
          ) : (
            <p>Công ty chưa có tag nào. Owner hoặc Admin tạo tag ở Cài đặt › Dữ liệu khách.</p>
          )}
          {failure ? (
            <div ref={alert} tabIndex={-1} role="alert">
              <p>{failure.text}</p>
              {failure.traceId ? (
                <p className="text-12 text-text-muted">Mã: {failure.traceId}</p>
              ) : null}
            </div>
          ) : null}
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70"
              disabled={!all.isSuccess}
            >
              Lưu tag
            </button>
            <button
              type="button"
              className="rounded-input border border-border-strong px-4 py-2"
              onClick={close}
            >
              Hủy
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
