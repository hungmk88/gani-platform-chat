// The people of a workspace (#21, `GET/PUT /v1/workspaces/{id}/members`, N159): an Owner or an Admin picks them among the members of
// the company (`GET /v1/members`, N153); the PUT sets the whole list. An invitation is not a member yet, so it cannot be picked.
import type { ApiError } from '../api/errors';
import { api } from '../api/client';
import type { components } from '../api/schema';
import { unwrap } from '../query/fetch';
import { membersPath, type Member } from '../members/list';

export type WorkspaceMemberList = components['schemas']['WorkspaceMemberList'];
type MemberPage = components['schemas']['MemberPage'];

/** The PUT takes at most 500 (N159): the pages of members read for the dialog stop there too. */
export const MAX_WORKSPACE_MEMBERS = 500;

/** Every member of the company, page after page, up to 500 (10 pages of 50). */
export async function readAllMembers(): Promise<Member[]> {
  const all: Member[] = [];
  let cursor: string | null = null;
  do {
    const page: MemberPage = await unwrap(api<MemberPage>(membersPath(cursor)));
    all.push(...page.data);
    cursor = page.nextCursor;
  } while (cursor && all.length < MAX_WORKSPACE_MEMBERS);
  return all;
}

/** Who can be picked: an account of the company, active or suspended (as the API checks), never an invitation. */
export const pickable = (members: readonly Member[]): Member[] =>
  members.filter((m) => (m.status === 'active' || m.status === 'suspended') && m.userId !== null);

/** Whether the picked ids are those the workspace already has, in any order. */
export function samePeople(picked: ReadonlySet<string>, current: WorkspaceMemberList): boolean {
  return picked.size === current.data.length && current.data.every((m) => picked.has(m.memberId));
}

/** The refusals of `PUT /v1/workspaces/{id}/members` in words of the screen. */
export function workspaceMembersError(error: ApiError): string {
  if (error.code === 'validation_failed')
    return 'Có người không còn là thành viên của công ty. Tải lại trang rồi chọn lại.';
  if (error.code === 'forbidden') return 'Chỉ Owner hoặc Admin đổi được người của workspace.';
  if (error.code === 'not_found') return 'Không tìm thấy workspace này. Tải lại trang rồi thử lại.';
  return error.message;
}
