'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { api } from '../api/client';
import { ApiFailure, unwrap } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import { HandlerField, useHandlers } from './handler-field';
import type { SecurityIncident } from './security';

const button = 'rounded-input border border-border-strong px-3 py-1 disabled:opacity-70';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';
const danger =
  'rounded-input border border-error-text bg-error-bg px-4 py-2 font-semibold text-error-text disabled:opacity-70';

type Change = { status: 'closed' } | { handlerUserId: string };

// #29 PR B2 (CEO 05/11, brief 61, 70, tầng 3): "Giao lại…" and "Đóng…" on an open incident. Who may: its handler, an Owner or an
// Admin (and the platform operator, on /platform later); the screen is the Owner's and the Admin's, so every open row has both.
export function IncidentActions({
  incident,
  onDone,
}: {
  incident: SecurityIncident;
  onDone: (said: string) => void;
}) {
  const [open, setOpen] = useState<'close' | 'hand' | null>(null);
  return (
    <div className="flex gap-2">
      <button
        type="button"
        className={button}
        aria-label={`Giao lại sự cố ${incident.title}`}
        onClick={() => setOpen('hand')}
      >
        Giao lại…
      </button>
      <button
        type="button"
        className={button}
        aria-label={`Đóng sự cố ${incident.title}`}
        onClick={() => setOpen('close')}
      >
        Đóng…
      </button>
      {open ? (
        <ChangeDialog
          incident={incident}
          close={open === 'close'}
          onClose={() => setOpen(null)}
          onDone={onDone}
        />
      ) : null}
    </div>
  );
}

// One dialog for both: closing says it cannot be undone (409 `incident_closed` once closed); handing over picks another active
// Owner or Admin (422 `invalid_handler` reads them again). `PATCH`, waiting for the server, no Idempotency-Key (it sets a value).
function ChangeDialog(props: {
  incident: SecurityIncident;
  close: boolean;
  onClose: () => void;
  onDone: (said: string) => void;
}) {
  const { incident, close } = props;
  const scope = useScope();
  const queries = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  // isPending is still false for the second click of a double click: a ref holds the one change being sent (as merge-dialog.tsx).
  const sending = useRef(false);
  const { members, handlers } = useHandlers();
  const [chosen, setChosen] = useState<string | undefined>();
  const handler = chosen ?? handlers.find((h) => h.userId !== incident.handler.id)?.userId;
  const reread = () =>
    queries.invalidateQueries({ queryKey: scopeKey(scope, 'security', 'incidents') });
  const send = useMutation<unknown, ApiFailure, Change>({
    mutationFn: (body) =>
      unwrap(
        api(`/v1/security-incidents/${encodeURIComponent(incident.id)}`, { method: 'PATCH', body }),
      ),
    onSuccess: () => {
      void reread();
      props.onDone(close ? 'Đã đóng sự cố. Đã ghi audit.' : 'Đã giao lại sự cố. Đã ghi audit.');
      dialog.current?.close();
    },
    onError: (e) => {
      if (e.error.code === 'incident_closed') void reread();
      if (e.error.code === 'invalid_handler') void members.refetch();
    },
  });
  // Never on "Đóng sự cố" or "Hủy": the dialog itself, then the list of handlers once read (#411).
  useEffect(() => (dialog.current?.showModal(), dialog.current?.focus()), []);
  useEffect(() => {
    if (!close && members.isSuccess) dialog.current?.querySelector('select')?.focus();
  }, [close, members.isSuccess]);
  const same = !close && (!handler || handler === incident.handler.id);

  let body: ReactNode;
  if (close) body = <p>Sự cố đã đóng không mở lại được.</p>;
  else
    body = (
      <>
        <p>Người xử lý hiện tại: {incident.handler.name}</p>
        <HandlerField members={members} handlers={handlers} value={handler} onChange={setChosen} />
      </>
    );
  return (
    <dialog
      ref={dialog}
      tabIndex={-1}
      aria-labelledby="incident-change-title"
      onClose={props.onClose}
      onCancel={(e) => send.isPending && e.preventDefault()}
      className="m-auto w-[480px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay"
    >
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (send.isPending || same || sending.current) return;
          sending.current = true;
          send.mutate(close ? { status: 'closed' } : { handlerUserId: handler as string }, {
            onSettled: () => (sending.current = false),
          });
        }}
      >
        <h3 id="incident-change-title" className="text-16 font-semibold">
          {close ? 'Đóng sự cố' : 'Giao lại sự cố'} “{incident.title}”
        </h3>
        {body}
        {send.error ? (
          <div role="alert">
            <p>{send.error.error.message}</p>
            {send.error.error.traceId ? (
              <p className="text-12 text-text-muted">Mã: {send.error.error.traceId}</p>
            ) : null}
          </div>
        ) : null}
        <div className="flex gap-2">
          <button
            type="submit"
            className={close ? danger : primary}
            disabled={send.isPending || same}
            aria-busy={send.isPending}
          >
            {send.isPending ? 'Đang lưu…' : close ? 'Đóng sự cố' : 'Giao'}
          </button>
          <button
            type="button"
            className={button}
            disabled={send.isPending}
            onClick={() => dialog.current?.close()}
          >
            Hủy
          </button>
        </div>
      </form>
    </dialog>
  );
}
