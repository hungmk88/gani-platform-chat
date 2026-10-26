'use client';

import { useState } from 'react';

import { useApiQuery } from '../query/provider';
import { RetryAction } from '../retry-button';
import { MembersDialog } from './members-dialog';
import { WorkspaceDialog } from './workspace-dialog';
import { TEMPLATE, type Workspace, type WorkspaceList } from './workspace';

const button = 'rounded-input border border-border-strong px-3 py-1';

/**
 * The workspaces of the company (#21, `GET /v1/workspaces`, N157), by name, each changed in a dialog (`WorkspaceDialog`), its people
 * picked in another (`MembersDialog`, N159). Only
 * Owner and Admin come here (the page checks), as the API allows.
 */
export function WorkspaceTable() {
  const list = useApiQuery<WorkspaceList>(['workspaces'], '/v1/workspaces');
  const [editing, setEditing] = useState<Workspace | null>(null);
  const [staffing, setStaffing] = useState<Workspace | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (list.isPending)
    return (
      <p role="status" aria-busy="true" className="text-text-muted">
        Đang tải workspace…
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
  if (!list.data.data.length)
    return (
      <div className="flex flex-col gap-2">
        <p>Công ty chưa có workspace nào: quản trị nền tảng tạo workspace theo mẫu.</p>
        <RetryAction onRetry={() => void list.refetch()} busy={list.isFetching} />
      </div>
    );
  return (
    <div className="flex flex-col gap-3">
      {notice ? <p role="status">{notice}</p> : null}
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full text-left">
          <thead className="bg-bg-subtle">
            <tr>
              {['Workspace', 'Mẫu', 'Múi giờ', 'Giới hạn tải mặc định', 'SĐT liên hệ'].map((t) => (
                <th key={t} scope="col" className="p-2 font-semibold">
                  {t}
                </th>
              ))}
              <th scope="col" className="p-2">
                <span className="sr-only">Thao tác</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {list.data.data.map((w) => (
              <tr key={w.id}>
                <td className="p-2">
                  <div>{w.name}</div>
                  <div className="text-12 text-text-muted">{w.slug}</div>
                </td>
                <td className="p-2">{TEMPLATE[w.template]}</td>
                <td className="p-2">{w.timezone}</td>
                <td className="p-2">{w.defaultMaxConcurrent} hội thoại</td>
                <td className="p-2">{w.contactPhone ?? 'Chưa đặt'}</td>
                <td className="p-2">
                  <button
                    type="button"
                    className={button}
                    aria-label={`Sửa workspace ${w.name}`}
                    onClick={() => {
                      setNotice(null);
                      setEditing(w);
                    }}
                  >
                    Sửa
                  </button>{' '}
                  <button
                    type="button"
                    className={button}
                    aria-label={`Người trong workspace ${w.name}`}
                    onClick={() => {
                      setNotice(null);
                      setStaffing(w);
                    }}
                  >
                    Người
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing ? (
        <WorkspaceDialog
          key={editing.id}
          workspace={editing}
          onClose={() => setEditing(null)}
          onDone={(w) => setNotice(`Đã lưu workspace ${w.name}.`)}
        />
      ) : null}
      {staffing ? (
        <MembersDialog
          key={staffing.id}
          workspace={staffing}
          onClose={() => setStaffing(null)}
          onDone={(n) => setNotice(`Đã lưu: workspace ${staffing.name} có ${n} người.`)}
        />
      ) : null}
    </div>
  );
}
