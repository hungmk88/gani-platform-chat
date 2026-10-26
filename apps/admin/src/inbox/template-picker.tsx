'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import type { ApiFailure } from '../query/fetch';
import type { QuickReply, QuickReplyList } from '../quick-replies/quick-replies';
import { RetryAction } from '../retry-button';
import { MAX_SHOWN } from './templates';

export const PICKER_ID = 'composer-templates';
export const optionId = (r: QuickReply) => `composer-template-${r.id}`;

/**
 * The templates under the reply box while it holds "/" and the start of a shortcut (C7c, N163): `/shortcut` and the start of the
 * text, as plain text. ↑/↓ move, Enter or Tab picks, Esc closes (the box handles the keys); a click picks too, the box keeps focus.
 */
export function TemplatePicker({
  q,
  list,
  active,
  onPick,
}: {
  q: string;
  list: UseQueryResult<QuickReplyList, ApiFailure>;
  active: number;
  onPick: (r: QuickReply) => void;
}) {
  if (list.isPending)
    return (
      <p role="status" aria-busy="true" className="text-12 text-text-muted">
        Đang tải mẫu…
      </p>
    );
  if (list.isError)
    return (
      <div role="alert" className="flex flex-col gap-2">
        <p>{list.error.error.message}</p>
        {list.error.error.traceId ? (
          <p className="text-12 text-text-muted">Mã: {list.error.error.traceId}</p>
        ) : null}
        <RetryAction onRetry={() => void list.refetch()} busy={list.isFetching} />
      </div>
    );
  const shown = list.data.data.slice(0, MAX_SHOWN);
  if (!shown.length)
    return (
      <p role="status" className="text-12 text-text-muted">
        {q
          ? `Không có mẫu nào bắt đầu bằng /${q}. Esc để viết tiếp.`
          : 'Workspace này chưa có mẫu trả lời nào. Esc để viết tiếp.'}
      </p>
    );
  return (
    <ul
      id={PICKER_ID}
      role="listbox"
      aria-label="Mẫu trả lời nhanh"
      className="flex flex-col divide-y divide-border rounded-card border border-border"
    >
      {shown.map((r, i) => (
        <li
          key={r.id}
          id={optionId(r)}
          role="option"
          aria-selected={i === active}
          className={`flex cursor-pointer flex-col px-3 py-2 ${i === active ? 'bg-bg-subtle' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(r)}
        >
          <span className="font-semibold">/{r.shortcut}</span>
          <span className="truncate text-12 text-text-muted">{r.body}</span>
        </li>
      ))}
    </ul>
  );
}

/** A field for each variable of Đợt 1 left in the text (C7c): what is typed replaces it when the message is sent. */
export function VariableFields({
  fields,
  values,
  onChange,
}: {
  fields: readonly { readonly name: string; readonly label: string }[];
  values: Readonly<Record<string, string>>;
  onChange: (name: string, value: string) => void;
}) {
  if (!fields.length) return null;
  return (
    <fieldset className="flex flex-wrap gap-3">
      <legend className="pb-1 text-12 text-text-muted">
        Điền vào tin trước khi gửi (thay cho {'{{…}}'})
      </legend>
      {fields.map((f) => (
        <label key={f.name} className="flex flex-col gap-1">
          <span className="text-12">{f.label}</span>
          <input
            value={values[f.name] ?? ''}
            maxLength={200}
            className="rounded-input border border-border-strong px-3 py-2"
            onChange={(e) => onChange(f.name, e.target.value)}
          />
        </label>
      ))}
    </fieldset>
  );
}
