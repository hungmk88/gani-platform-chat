/** The tabs of /settings/workspace by `?tab=` (CEO 03/11, brief 52), links as /me; the workspaces of the company stay the first. */
export const TABS = [
  ['info', 'Workspace'],
  ['hours', 'Giờ làm việc'],
] as const;
export type Tab = (typeof TABS)[number][0];

/** The tab a URL asks for; anything else is the first one. */
export const tabOf = (raw: string | undefined): Tab => TABS.find(([k]) => k === raw)?.[0] ?? 'info';
