// #21 Workspace (`/settings/workspace`, N157): the workspaces of the company as `GET /v1/workspaces` gives them. Business hours, SLA
// and allocation (spec-M8 §3.3–3.5) have no API yet.
import type { components } from '../api/schema';

export type Workspace = components['schemas']['Workspace'];
export type WorkspaceList = components['schemas']['WorkspaceList'];

/** The templates in words; a template is chosen when the workspace is made (spec-M8 A2), never changed here. */
export const TEMPLATE: Readonly<Record<Workspace['template'], string>> = {
  b2b_sales: 'B2B bán hàng',
  b2c_order: 'B2C đặt hàng',
  service: 'Dịch vụ',
};
