// The menu of the admin (apps/admin/CLAUDE.md): 5 fixed groups, at most 2 levels, hidden by role (Phụ lục B) and by phase.
// Đợt 2 screens (quotes, orders, automation, knowledge, reports, widget) are left out of Đợt 1 entirely, not shown and refused.

export const ROLES = [
  'owner',
  'admin',
  'manager',
  'sales',
  'support',
  'marketing',
  'viewer',
  'platform_operator',
] as const;
export type Role = (typeof ROLES)[number];

/** The names of the roles as people read them (prototype, Phụ lục B), in the order of ROLES: the order of every role menu. */
export const ROLE_NAME: Readonly<Record<Role, string>> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  sales: 'Sales',
  support: 'Support',
  marketing: 'Marketing',
  viewer: 'Viewer',
  platform_operator: 'Platform operator',
};

export interface NavItem {
  readonly href: string;
  readonly label: string;
}
export interface NavGroup {
  readonly label: string;
  readonly items: readonly NavItem[];
}

const ALL_ORG: readonly Role[] = [
  'owner',
  'admin',
  'manager',
  'sales',
  'support',
  'marketing',
  'viewer',
];
const AGENTS: readonly Role[] = ['owner', 'admin', 'manager', 'sales', 'support'];
const LEADS: readonly Role[] = ['owner', 'admin', 'manager'];
const ORG_ADMINS: readonly Role[] = ['owner', 'admin'];

// [group, [href, label, roles]]: the same rows as the prototype (prototype/dot1/assets/proto.js), with the routes of the app.
const MENU: readonly [string, readonly (readonly [string, string, readonly Role[]])[]][] = [
  ['Hộp thư', [['/inbox', 'Hộp thư', AGENTS]]],
  [
    'Khách hàng',
    [
      ['/customers', 'Khách hàng', ALL_ORG],
      ['/leads', 'Lead', ALL_ORG],
      ['/tickets', 'Ticket', AGENTS],
    ],
  ],
  ['Tự động hóa', [['/bots', 'Bot', LEADS]]],
  ['Tổng quan & Báo cáo', [['/overview', 'Tổng quan', ALL_ORG]]],
  [
    'Cài đặt',
    [
      ['/settings/workspace', 'Workspace', ORG_ADMINS],
      ['/settings/members', 'Thành viên', ORG_ADMINS],
      ['/settings/teams', 'Team', ORG_ADMINS],
      ['/settings/channels', 'Kênh', ORG_ADMINS],
      ['/settings/ai', 'AI nội bộ', ORG_ADMINS],
      ['/settings/autonomy', 'Tự chủ & feature flag', ORG_ADMINS],
      ['/settings/audit', 'Audit log', ORG_ADMINS],
      ['/settings/security', 'Bảo mật', ORG_ADMINS],
    ],
  ],
];

/** The groups this role sees, each with the items it may open; a group with no item is left out. */
export function navFor(role: Role): NavGroup[] {
  if (role === 'platform_operator')
    return [{ label: 'Platform', items: [{ href: '/platform', label: 'Platform' }] }];
  return MENU.map(([label, rows]) => ({
    label,
    items: rows
      .filter(([, , roles]) => roles.includes(role))
      .map(([href, text]) => ({ href, label: text })),
  })).filter((g) => g.items.length > 0);
}

/** The page after sign-in (apps/admin/CLAUDE.md "Trang mặc định"). */
export function homeFor(role: Role): string {
  if (role === 'platform_operator') return '/platform';
  return role === 'sales' || role === 'support' ? '/inbox' : '/overview';
}

/** The item of the menu this role may open at `path`, if any: a screen of the menu not built yet says so instead of a 404. */
export function menuItemAt(role: Role, path: string): NavItem | undefined {
  return navFor(role)
    .flatMap((g) => g.items)
    .find((i) => i.href === path);
}

/** A screen that is built, for the one action of a screen that is not: the inbox for those who hold conversations, else the profile. */
export function builtFor(role: Role): NavItem {
  return AGENTS.includes(role)
    ? { href: '/inbox', label: 'Mở Hộp thư' }
    : { href: '/me', label: 'Mở hồ sơ cá nhân' };
}
