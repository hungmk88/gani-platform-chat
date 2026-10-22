// The parts of #5 Hồ sơ cá nhân, read from `?tab=` by the page (a server component) and drawn by the client component.

export const TABS = [
  ['info', 'Thông tin'],
  ['security', 'Bảo mật'],
  ['notify', 'Thông báo'],
] as const;
export type Tab = (typeof TABS)[number][0];

/** The part a URL asks for; anything else is the first one. */
export const tabOf = (raw: string | undefined): Tab => TABS.find(([k]) => k === raw)?.[0] ?? 'info';
