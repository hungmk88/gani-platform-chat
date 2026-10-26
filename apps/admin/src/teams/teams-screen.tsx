'use client';

import { useScope } from '../query/provider';
import { TeamTable } from './team-list';
import { TeamForm } from './team-form';

/**
 * #20 Team for the workspace being worked in (chosen in the top bar, T1): make a team, then the list. `readOnly`: a Manager, who
 * only reads the teams it belongs to (the API answers those only; CEO, 26/10): no form, no action on a row.
 */
export function TeamsScreen({ readOnly }: { readOnly: boolean }) {
  const { workspaceId } = useScope();
  if (!workspaceId)
    return <p>Bạn chưa thuộc workspace nào. Nhờ Owner thêm bạn ở Cài đặt › Workspace.</p>;
  return (
    <>
      {readOnly ? null : <TeamForm workspaceId={workspaceId} />}
      <TeamTable workspaceId={workspaceId} readOnly={readOnly} />
    </>
  );
}
