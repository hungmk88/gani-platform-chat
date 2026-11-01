'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Paged } from '../paged-list';
import { useApiPages } from '../query/provider';
import { timeText } from '../security/security';
import {
  actorOf,
  auditFilterOf,
  auditParamsOf,
  dayText,
  defaultWindow,
  detailLines,
  filterProblem,
  isDefaultWindow,
  logsPath,
  vnDay,
  type AuditFilter,
  type AuditLog,
  type AuditLogList,
} from './audit';

const field = 'rounded-input border border-border-strong px-3 py-2';
const button = 'rounded-input border border-border-strong px-3 py-1';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on';
const code = 'font-mono text-12';
/** The form's fields: a text field has a hint and the API's longest code (64), a day is a date up to today. */
const FIELDS = [
  ['Hành động', 'action', 'member.role_changed'],
  ['Loại đối tượng', 'targetType', 'member'],
  ['Từ ngày', 'from', ''],
  ['Đến ngày', 'to', ''],
] as const;

/** Who acted: the system in words, a person as a button that shows what they alone did (their whole id in the tooltip). */
function Actor({
  id,
  meId,
  pick,
}: {
  id: string | null;
  meId: string;
  pick: (id: string) => void;
}) {
  const actor = actorOf(id, meId);
  if (!id) return actor.text;
  return (
    <button type="button" className="text-left text-accent underline" onClick={() => pick(id)}>
      <abbr title={actor.title}>{actor.text}</abbr>
    </button>
  );
}

/** The detail as plain text, one key a line: never HTML, a nested value as JSON in code. */
function Detail({ detail }: { detail: AuditLog['detail'] }) {
  const lines = detailLines(detail);
  if (lines.length === 0) return '—';
  return (
    <ul className="flex flex-col gap-1">
      {lines.map((l) => (
        <li key={l.key} className="break-words">
          {l.key}: {l.code ? <code className={code}>{l.value}</code> : l.value}
        </li>
      ))}
    </ul>
  );
}

/**
 * #28 Audit log of the company (CEO 31/10), read only: the filters in the URL like the Inbox, the last 7 days of Viet Nam unless
 * other days are chosen, pages by cursor. A person is named by the last 8 characters of their id until the API gives names (U72);
 * an action is its code (U73). What the API would refuse is said before asking (`filterProblem`).
 */
export function AuditScreen({ meId }: { meId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [now] = useState(() => new Date());
  const filter = auditFilterOf(useSearchParams(), now, meId);
  const logs = useApiPages<AuditLogList>(['audit-logs', filter], (c) => logsPath(filter, c));
  const [problem, setProblem] = useState<string | null>(null);
  const query = auditParamsOf(filter, now).toString();
  const go = (f: AuditFilter) => {
    setProblem(null);
    const q = auditParamsOf(f, now).toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  };
  const clear = () => go({ actorUserId: null, action: '', targetType: '', ...defaultWindow(now) });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    // Every field of the form is text (no file).
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === 'string' ? value.trim() : '';
    };
    const next = {
      ...filter,
      action: text('action'),
      targetType: text('targetType'),
      from: text('from'),
      to: text('to'),
    };
    const why = filterProblem(next);
    if (why) setProblem(why);
    else go(next);
  };
  const other =
    filter.actorUserId && filter.actorUserId !== meId ? actorOf(filter.actorUserId, meId) : null;
  const clearButton = (
    <button type="button" className={button} onClick={clear}>
      Bỏ lọc
    </button>
  );
  return (
    <section aria-labelledby="audit-title" className="flex max-w-[1080px] flex-col gap-4">
      <h1 id="audit-title" className="text-20 font-semibold">
        Audit log
      </h1>
      <div role="group" aria-label="Người thực hiện" className="flex flex-wrap items-center gap-2">
        Người thực hiện:
        {(
          [
            ['Tất cả', null],
            ['Tôi', meId],
          ] as const
        ).map(([word, id]) => (
          <button
            key={word}
            type="button"
            aria-pressed={filter.actorUserId === id}
            onClick={() => go({ ...filter, actorUserId: id })}
            className={`${button} ${filter.actorUserId === id ? 'bg-accent text-accent-on' : ''}`}
          >
            {word}
          </button>
        ))}
        {other ? (
          <span>
            Đang xem việc của <abbr title={other.title}>{other.text}</abbr>
          </span>
        ) : null}
      </div>
      <form key={query} noValidate onSubmit={submit} className="flex flex-wrap items-end gap-4">
        {FIELDS.map(([label, name, hint]) => (
          <label key={name} className="flex flex-col gap-1">
            {label}
            <input
              name={name}
              defaultValue={filter[name]}
              {...(hint ? { placeholder: hint, maxLength: 64 } : { type: 'date', max: vnDay(now) })}
              className={`${field} ${hint ? 'font-mono' : ''}`}
            />
          </label>
        ))}
        <button type="submit" className={primary}>
          Lọc
        </button>
        {query ? clearButton : null}
      </form>
      {problem ? (
        <p role="alert" className="text-error-text">
          {problem}
        </p>
      ) : null}
      {isDefaultWindow(filter, now) ? null : (
        <p className="text-12 text-text-muted">Bỏ lọc sẽ đưa về 7 ngày gần nhất.</p>
      )}
      <p>
        Đang xem từ {dayText(filter.from)} đến {dayText(filter.to)} (giờ Việt Nam)
      </p>
      <Paged
        query={logs}
        loading="Đang tải audit log…"
        empty={
          <div className="flex flex-col items-start gap-2">
            <p>
              {query
                ? 'Không có hoạt động nào khớp bộ lọc.'
                : 'Chưa có hoạt động nào trong 7 ngày gần nhất.'}
            </p>
            {query ? (
              clearButton
            ) : (
              <button
                type="button"
                className={button}
                disabled={logs.isFetching}
                aria-busy={logs.isFetching}
                onClick={() => void logs.refetch()}
              >
                Làm mới
              </button>
            )}
          </div>
        }
        head={['Thời điểm', 'Người thực hiện', 'Hành động', 'Đối tượng', 'Chi tiết']}
        row={(log) => (
          <tr key={log.id} className="align-top">
            <td className="p-2 whitespace-nowrap">{timeText(log.createdAt)}</td>
            <td className="p-2">
              <Actor
                id={log.actorUserId}
                meId={meId}
                pick={(id) => go({ ...filter, actorUserId: id })}
              />
            </td>
            <td className="p-2">
              <code className={code}>{log.action}</code>
            </td>
            <td className="p-2">
              {log.targetType ? <code className={code}>{log.targetType}</code> : '—'}
              {log.targetId ? (
                <>
                  {' '}
                  <abbr title={log.targetId}>…{log.targetId.slice(-8)}</abbr>
                </>
              ) : null}
            </td>
            <td className="p-2">
              <Detail detail={log.detail} />
            </td>
          </tr>
        )}
      />
      <p className="text-12 text-text-muted">
        Hành động hiện theo mã của API. Bấm vào người thực hiện để chỉ xem việc của người đó. Chỉ
        xem: không sửa hay xóa ở màn này. Không áp dụng AI ở màn này.
      </p>
    </section>
  );
}
