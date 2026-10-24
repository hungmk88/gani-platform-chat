'use client';

import { useScope } from '../query/provider';
import { TeamTable } from './team-list';
import { TeamForm } from './team-form';

/** #20 Team for the workspace being worked in (chosen in the top bar, T1): make a team, then the list. */
export function TeamsScreen() {
  const { workspaceId } = useScope();
  if (!workspaceId)
    return <p>Bạn chưa thuộc workspace nào. Nhờ Owner thêm bạn ở Cài đặt › Workspace.</p>;
  return (
    <>
      <TeamForm workspaceId={workspaceId} />
      <TeamTable workspaceId={workspaceId} />
    </>
  );
}
