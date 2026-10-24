// #21 Workspace (`/settings/workspace`, N157): the workspaces of the company as `GET /v1/workspaces` gives them, and what an Owner or
// an Admin may change with `PATCH /v1/workspaces/{id}`: the name, the time zone, the default load limit (C9). Business hours, SLA and
// allocation (spec-M8 §3.3–3.5) have no API yet.
import type { ApiError } from '../api/errors';
import type { components } from '../api/schema';

export type Workspace = components['schemas']['Workspace'];
export type WorkspaceList = components['schemas']['WorkspaceList'];
type Change = components['schemas']['WorkspaceChange'];

/** The templates in words; a template is chosen when the workspace is made (spec-M8 A2), never changed here. */
export const TEMPLATE: Readonly<Record<Workspace['template'], string>> = {
  b2b_sales: 'B2B bán hàng',
  b2c_order: 'B2C đặt hàng',
  service: 'Dịch vụ',
};

export const MAX_NAME = 100;
export const MAX_LIMIT = 100;

/** The IANA zones this browser knows, the workspace's own first if it does not (the API checks the same way). */
export function timeZones(current: string): readonly string[] {
  const known = Intl.supportedValuesOf('timeZone');
  return known.includes(current) ? known : [current, ...known];
}

export interface Draft {
  readonly name: string;
  readonly timezone: string;
  readonly limit: string;
}

export const draftOf = (w: Workspace): Draft => ({
  name: w.name,
  timezone: w.timezone,
  limit: String(w.defaultMaxConcurrent),
});

/**
 * What the form changes, as the body of the PATCH (only the fields that differ, the name trimmed like the API), or why it cannot be
 * sent. An empty body means nothing changed: the API refuses it (400), so the dialog just closes.
 */
export function changeOf(w: Workspace, d: Draft): Change | string {
  const name = d.name.trim();
  if (!name) return 'Nhập tên workspace.';
  if (name.length > MAX_NAME) return `Tên tối đa ${MAX_NAME} ký tự.`;
  const limit = Number(d.limit.trim());
  if (!d.limit.trim() || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
    return `Giới hạn tải là số nguyên từ 1 đến ${MAX_LIMIT}.`;
  return {
    ...(name !== w.name ? { name } : {}),
    ...(d.timezone !== w.timezone ? { timezone: d.timezone } : {}),
    ...(limit !== w.defaultMaxConcurrent ? { defaultMaxConcurrent: limit } : {}),
  };
}

/** The list with one workspace replaced by the API's answer. */
export function withWorkspace(
  list: WorkspaceList | undefined,
  w: Workspace,
): WorkspaceList | undefined {
  return list && { data: list.data.map((x) => (x.id === w.id ? w : x)) };
}

/** The refusals of `PATCH /v1/workspaces/{id}` in words of the screen. */
export function workspaceError(error: ApiError): string {
  if (error.code === 'validation_failed')
    return 'Máy chủ không nhận giá trị này (tên 1–100 ký tự, múi giờ hợp lệ, giới hạn 1–100).';
  if (error.code === 'forbidden') return 'Chỉ Owner hoặc Admin sửa được workspace.';
  if (error.code === 'not_found') return 'Không tìm thấy workspace này. Tải lại trang rồi thử lại.';
  return error.message;
}
