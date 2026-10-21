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
