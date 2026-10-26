'use client';

import { useState } from 'react';

import { useApiQuery } from '../query/provider';
import { RetryAction } from '../retry-button';
import { TeamChannelsDialog } from './team-channels-dialog';
import { EndTeamDialog, TeamDialog } from './team-dialogs';
import { TeamMembersDialog } from './team-members-dialog';
import { teamsPath, type Team, type TeamList } from './teams';

const badge = 'rounded-input bg-bg-subtle px-2 py-1 text-12';
const button = 'rounded-input border border-border-strong px-3 py-1';

/**
 * The teams of the workspace being worked in (#20, `GET /v1/teams?workspaceId=`, N160), by name; each changed (`TeamDialog`),
 * given its people (`TeamMembersDialog`) and its channels (`TeamChannelsDialog`, not the default team: what no team answers is
 * its already), or ended (`EndTeamDialog`) from its row. `readOnly` (a Manager): its own teams, no column of actions.
 */
export function TeamTable({ workspaceId, readOnly }: { workspaceId: string; readOnly: boolean }) {
  const list = useApiQuery<TeamList>(['teams', workspaceId], teamsPath(workspaceId));
  const [editing, setEditing] = useState<Team | null>(null);
  const [ending, setEnding] = useState<Team | null>(null);
  const [staffing, setStaffing] = useState<Team | null>(null);
  const [routing, setRouting] = useState<Team | null>(null);
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
        readOnly ? (
          <p>Bạn chưa thuộc team nào của workspace này. Nhờ Owner hoặc Admin thêm bạn vào team.</p>
        ) : (
          <p>Workspace này chưa có team nào. Tạo team đầu tiên bằng form ở trên.</p>
        )
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
                {readOnly ? null : (
                  <th scope="col" className="p-2">
                    <span className="sr-only">Thao tác</span>
                  </th>
                )}
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
                  {readOnly ? null : (
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
                        {t.isDefault ? null : (
                          <button
                            type="button"
                            className={button}
                            aria-label={`Kênh của team ${t.name}`}
                            onClick={() => {
                              setNotice(null);
                              setRouting(t);
                            }}
                          >
                            Kênh
                          </button>
                        )}
                        {t.isDefault ? null : (
                          <button
                            type="button"
                            className={button}
                            aria-label={`Kết thúc team ${t.name}`}
                            onClick={() => {
                              setNotice(null);
                              setEnding(t);
                            }}
                          >
                            Kết thúc…
                          </button>
                        )}
                      </div>
                    </td>
                  )}
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
      {ending ? (
        <EndTeamDialog
          key={ending.id}
          team={ending}
          onClose={() => setEnding(null)}
          onDone={(t) => setNotice(`Đã kết thúc team ${t.name}.`)}
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
      {routing ? (
        <TeamChannelsDialog
          key={routing.id}
          team={routing}
          onClose={() => setRouting(null)}
          onDone={(n) => setNotice(`Đã lưu kênh của team ${routing.name} (${n} kênh).`)}
        />
      ) : null}
    </section>
  );
}
