// The screens of the stub API that live in a file of their own (e2e/stub-*.ts), tried in turn: each answers its own routes and
// says false for any other. #19 Thành viên (N152–N156), #21 Workspace (N157–N159), #24 Kênh (N161), #20 Team (N160), #22 Mẫu trả
// lời nhanh (N163), #7 Khách hàng (N165), #16 Tổng quan and #14 Ticket (N167). Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

import { routeChannels } from './stub-channels';
import { routeCustomers } from './stub-customers';
import type { Edge } from './stub-members';
import { routeMembers } from './stub-members';
import { routeOverview } from './stub-overview';
import { routeQuickReplies } from './stub-quick-replies';
import { routeTeams } from './stub-teams';
import { routeTickets } from './stub-tickets';
import { routeWorkspaces } from './stub-workspaces';

const PREFIXES = [
  'members',
  'workspaces',
  'teams',
  'channels',
  'quick-replies',
  'customers',
  'overview',
  'tickets',
];

/** Answers the route with the module that owns it and says true, or says false when none does. */
export async function routeScreens(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  who: { readonly sid: string; readonly role: string | undefined; readonly email: string } | null,
  edge: Edge,
): Promise<boolean> {
  if (!PREFIXES.some((p) => path.startsWith(`/v1/${p}`))) return false;
  for (const route of [
    routeMembers,
    routeWorkspaces,
    routeChannels,
    routeTeams,
    routeQuickReplies,
    routeCustomers,
  ])
    if (await route(req, res, path, who, edge)) return true;
  return routeOverview(req, res, path, who, edge) || routeTickets(req, res, path, who, edge);
}
