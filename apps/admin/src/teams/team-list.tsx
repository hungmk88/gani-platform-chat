'use client';

import { useState } from 'react';

import { useApiQuery } from '../query/provider';
import { RetryAction } from '../retry-button';
import { TeamDialog } from './team-dialogs';
import { TeamMembersDialog } from './team-members-dialog';
import { teamsPath, type Team, type TeamList } from './teams';

const badge = 'rounded-input bg-bg-subtle px-2 py-1 text-12';
const button = 'rounded-input border border-border-strong px-3 py-1';

/**
 * The teams of the workspace being worked in (#20, `GET /v1/teams?workspaceId=`, N160), by name; each changed from its row
 * (`TeamDialog`), its people picked there too (`TeamMembersDialog`).
 */
export function TeamTable({ workspaceId }: { workspaceId: string }) {
  const list = useApiQuery<TeamList>(['teams', workspaceId], teamsPath(workspaceId));
  const [editing, setEditing] = useState<Team | null>(null);
  const [staffing, setStaffing] = useState<Team | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <section aria-labelledby="teams-title" className="flex flex-col gap-3">
      <h2 id="teams-title" className="text-16 font-semibold">
        Team của workspace
      </h2>
      {notice ? <p role="status">{notice}</p> : null}
      {list.isPending ? (
        <p role="status" aria-busy="true" className="text-text-muted">
          Đang tải team…
        </p>
      ) : list.isError ? (
        <div role="alert" className="flex flex-col gap-2">
          <p>{list.error.error.message}</p>
          {list.error.error.traceId ? (
            <p className="text-12 text-text-muted">Mã: {list.error.error.traceId}</p>
          ) : null}
          <RetryAction onRetry={() => void list.refetch()} busy={list.isFetching} />
        </div>
      ) : list.data.data.length === 0 ? (
        <p>Workspace này chưa có team nào. Tạo team đầu tiên bằng form ở trên.</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full text-left">
            <thead className="bg-bg-subtle">
              <tr>
                {['Team', 'Mô tả', 'Số người'].map((t) => (
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
              {list.data.data.map((t) => (
                <tr key={t.id}>
                  <td className="p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {t.name}
                      {t.isDefault ? <span className={badge}>Mặc định</span> : null}
                    </div>
                    <div className="text-12 text-text-muted">{t.slug}</div>
                  </td>
                  <td className="p-2">{t.description ?? '—'}</td>
                  <td className="p-2">{t.memberCount}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={button}
                        aria-label={`Sửa team ${t.name}`}
                        onClick={() => {
                          setNotice(null);
                          setEditing(t);
                        }}
                      >
                        Sửa
                      </button>
                      <button
                        type="button"
                        className={button}
                        aria-label={`Người của team ${t.name}`}
                        onClick={() => {
                          setNotice(null);
                          setStaffing(t);
                        }}
                      >
                        Người
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing ? (
        <TeamDialog
          key={editing.id}
          team={editing}
          onClose={() => setEditing(null)}
          onDone={(t) => setNotice(`Đã lưu team ${t.name}.`)}
        />
      ) : null}
      {staffing ? (
        <TeamMembersDialog
          key={staffing.id}
          team={staffing}
          onClose={() => setStaffing(null)}
          onDone={(n) => setNotice(`Đã lưu người của team ${staffing.name} (${n} người).`)}
        />
      ) : null}
    </section>
  );
}
