'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import { CHANNEL_TYPE } from '../channels/channels';
import { readListKey } from '../customer-data/catalog-screen';
import { useApiQuery } from '../query/provider';
import { RetryAction } from '../retry-button';
import { timeText } from '../security/security';
import { MESSAGE_CLASS, POLICIES_PATH, type ChannelPolicy } from './platform';
import {
  creatorText,
  VERSION_STATE,
  versionsPath,
  type PolicyVersion,
  type PolicyVersionList,
} from './policy-versions';

const button = 'rounded-input border border-border-strong px-4 py-2 disabled:opacity-70';
const TONE: Partial<Record<PolicyVersion['state'], string>> = {
  in_force: 'bg-ok-bg text-ok-text',
  scheduled: 'bg-warn-bg text-warn-text',
};

/**
 * "Phiên bản chính sách kênh" (U80, brief B-U80): every version of one channel and class, read only, the latest first as the API
 * gives. The dialog opens while the list loads, so the focus is on the dialog itself (#411). The key sits under the policies' list,
 * so adding a version (`policy-dialog.tsx`) reads this again.
 */
export function VersionsDialog(props: {
  policy: ChannelPolicy;
  meId: string;
  onClose: () => void;
}) {
  const { policy, meId } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const path = versionsPath(policy);
  const versions = useApiQuery<PolicyVersionList>(
    [...readListKey(POLICIES_PATH), 'versions', policy.channelType, policy.messageClass],
    path,
  );
  useEffect(() => (dialog.current?.showModal(), dialog.current?.focus()), []);
  const rows = versions.data?.data ?? [];

  let body: ReactNode;
  if (versions.isPending)
    body = (
      <p role="status" aria-busy="true" className="text-text-muted">
        Đang tải phiên bản…
      </p>
    );
  else if (versions.isError && versions.error.error.code === 'not_found')
    body = <p>Phiên bản: chưa có trong bản hiện tại.</p>;
  else if (versions.isError)
    body = (
      <div role="alert" className="flex flex-col gap-2">
        <p>{versions.error.error.message}</p>
        {versions.error.error.traceId ? (
          <p className="text-12 text-text-muted">Mã: {versions.error.error.traceId}</p>
        ) : null}
        <RetryAction onRetry={() => void versions.refetch()} busy={versions.isFetching} />
      </div>
    );
  else if (!rows.length) body = <p>Chưa có phiên bản.</p>;
  else
    body = (
      <>
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full text-left">
            <thead className="bg-bg-subtle">
              <tr>
                {['Trạng thái', 'Áp dụng từ', 'Đến', 'Người tạo', 'Tạo lúc'].map((t) => (
                  <th key={t} scope="col" className="p-2 font-semibold">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((v) => (
                <tr key={v.id}>
                  <td className="p-2">
                    <span className={`rounded-input px-2 ${TONE[v.state] ?? ''}`}>
                      {VERSION_STATE[v.state]}
                    </span>
                  </td>
                  <td className="p-2">{timeText(v.effectiveFrom)}</td>
                  <td className="p-2">{timeText(v.effectiveTo)}</td>
                  <td className="p-2">{creatorText(v.createdBy, meId)}</td>
                  <td className="p-2">{timeText(v.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.some((v) => v.state === 'scheduled') ? (
          <p>Tới ngày đó bảng vẫn hiện phiên bản đang dùng.</p>
        ) : null}
      </>
    );

  return (
    <dialog
      ref={dialog}
      tabIndex={-1}
      aria-labelledby="versions-title"
      onClose={props.onClose}
      className="m-auto w-[640px] max-w-full rounded-dialog bg-surface p-6 shadow-dialog backdrop:bg-overlay"
    >
      <div className="flex flex-col gap-3">
        <h3 id="versions-title" className="text-16 font-semibold">
          Phiên bản chính sách kênh
        </h3>
        <p>
          {CHANNEL_TYPE[policy.channelType]} · {MESSAGE_CLASS[policy.messageClass]}, mới nhất trước.
          &quot;Đến&quot; là lúc phiên bản sau bắt đầu.
        </p>
        {body}
        <div>
          <button type="button" className={button} onClick={() => dialog.current?.close()}>
            Đóng
          </button>
        </div>
      </div>
    </dialog>
  );
}
