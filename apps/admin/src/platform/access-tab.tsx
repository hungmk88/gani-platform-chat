'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import { Paged } from '../paged-list';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useApiPages, useApiQuery, useScope } from '../query/provider';
import { timeText } from '../security/security';
import {
  COMPANIES_PATH,
  endPath,
  endText,
  running,
  sessionsPath,
  type AccessSession,
  type AccessSessionPage,
} from './access';
import { CreateDialog, primary } from './access-create';
import type { TenantHealthPage } from './platform';

const field = 'rounded-input border border-border-strong px-3 py-2';
const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const danger =
  'rounded-input border border-error-text bg-error-bg px-4 py-2 font-semibold text-error-text disabled:opacity-70';

/** "Kết thúc sớm" of one running session, asked again: `POST …/end`; focus on the dialog itself, never on its buttons (#411). */
function EndDialog(props: {
  session: AccessSession;
  onClose: () => void;
  onDone: (said: string) => void;
}) {
  const { session } = props;
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const reread = () =>
    queries.invalidateQueries({ queryKey: scopeKey(scope, 'platform', 'sessions') });
  const end = useMutation<unknown, ApiFailure, void>({
    mutationFn: () => unwrap(api(endPath(session.id), { method: 'POST' })),
    onSuccess: () => {
      void reread();
      props.onDone(`Đã kết thúc phiên ở ${session.orgName}. Đã ghi audit.`);
      dialog.current?.close();
    },
    onError: (e) => void (e.error.code === 'not_found' && reread()),
  });
  useEffect(() => (dialog.current?.showModal(), dialog.current?.focus()), []);
  const failure = end.error?.error;
  return (
    <dialog
      ref={dialog}
      tabIndex={-1}
      aria-labelledby="end-title"
      onClose={props.onClose}
      onCancel={(e) => end.isPending && e.preventDefault()}
      className="m-auto w-[480px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay"
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => (e.preventDefault(), !end.isPending && end.mutate())}
      >
        <h3 id="end-title" className="text-16 font-semibold">
          Kết thúc sớm phiên truy cập
        </h3>
        <p>
          Kết thúc phiên ở {session.orgName} trước {timeText(session.expiresAt)}? Muốn xem lại dữ
          liệu công ty này phải mở phiên mới.
        </p>
        {failure ? (
          <div role="alert">
            <p>{failure.message}</p>
            {failure.traceId ? (
              <p className="text-12 text-text-muted">Mã: {failure.traceId}</p>
            ) : null}
          </div>
        ) : null}
        <div className="flex gap-2">
          <button
            type="submit"
            className={danger}
            disabled={end.isPending}
            aria-busy={end.isPending}
          >
            {end.isPending ? 'Đang gửi…' : 'Kết thúc phiên'}
          </button>
          <button
            type="button"
            className={button}
            disabled={end.isPending}
            onClick={() => dialog.current?.close()}
          >
            Hủy
          </button>
        </div>
      </form>
    </dialog>
  );
}

/**
 * #30 "Phiên truy cập" (U79, brief A-U79, tầng 1): the operator's own sessions, newest first, by company and only those still
 * running (by default); "Tạo phiên" opens one for 60 minutes with a reason (PR U79b, `access-create.tsx`), "Kết thúc sớm…" ends
 * a running one. A 404 of the list is one line, as the other tabs.
 */
export function AccessTab() {
  const [orgId, setOrgId] = useState('');
  const [active, setActive] = useState(true);
  const [ending, setEnding] = useState<AccessSession | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const said = useRef<HTMLParagraphElement>(null);
  useEffect(() => said.current?.focus(), [notice]);
  const companies = useApiQuery<TenantHealthPage>(['platform', 'companies'], COMPANIES_PATH);
  const sessions = useApiPages<AccessSessionPage>(['platform', 'sessions', orgId, active], (c) =>
    sessionsPath(orgId, active, c),
  );
  // "Still running" as of the last read of the list (not Date.now() during render: React wants renders pure).
  const now = sessions.dataUpdatedAt;
  return (
    <section aria-labelledby="access-title" className="flex flex-col gap-3">
      <h2 id="access-title" className="text-16 font-semibold">
        Phiên truy cập
      </h2>
      <div>
        <button
          type="button"
          className={primary}
          onClick={() => (setNotice(null), setCreating(true))}
        >
          Tạo phiên
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          Công ty
          <select value={orgId} className={field} onChange={(e) => setOrgId(e.target.value)}>
            <option value="">Tất cả công ty</option>
            {(companies.data?.data ?? []).map((c) => (
              <option key={c.orgId} value={c.orgId}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex gap-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Chỉ phiên còn hiệu lực
        </label>
      </div>
      {notice ? (
        <p ref={said} role="status" tabIndex={-1}>
          {notice}
        </p>
      ) : null}
      {sessions.isError && sessions.error.error.code === 'not_found' ? (
        <p>Phiên truy cập: chưa có trong bản hiện tại.</p>
      ) : (
        <Paged<AccessSession>
          query={sessions}
          loading="Đang tải phiên truy cập…"
          empty={<p>{active ? 'Không có phiên nào còn hiệu lực.' : 'Chưa có phiên nào.'}</p>}
          head={['Công ty', 'Lý do', 'Bắt đầu', 'Trạng thái', 'Thao tác']}
          row={(s) => (
            <tr key={s.id}>
              <td className="p-2">{s.orgName}</td>
              <td className="whitespace-pre-line p-2">{s.reason}</td>
              <td className="p-2">{timeText(s.startedAt)}</td>
              <td className="p-2">{endText(s, now)}</td>
              <td className="p-2">
                {running(s, now) ? (
                  <button
                    type="button"
                    className="rounded-input border border-border-strong px-3 py-1"
                    aria-label={`Kết thúc sớm phiên ở ${s.orgName}`}
                    onClick={() => (setNotice(null), setEnding(s))}
                  >
                    Kết thúc sớm…
                  </button>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          )}
        />
      )}
      {ending ? (
        <EndDialog session={ending} onClose={() => setEnding(null)} onDone={setNotice} />
      ) : null}
      {creating ? (
        <CreateDialog
          companies={companies.data?.data ?? []}
          onClose={() => setCreating(false)}
          onDone={setNotice}
        />
      ) : null}
    </section>
  );
}
