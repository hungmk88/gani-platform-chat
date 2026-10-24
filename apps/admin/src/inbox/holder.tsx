'use client';

import type { components } from '../api/schema';
import { membersPath } from '../members/list';
import { useApiPages } from '../query/provider';
import { holderNameOf } from './assign';
import { holderOf, type Conversation } from './list';

type MemberPage = components['schemas']['MemberPage'];

/** "Phụ trách: …" of an open conversation: by name for Owner and Admin (from `GET /v1/members`), in words otherwise (U30). */
export function Holder({ c, meId, named }: { c: Conversation; meId: string; named: boolean }) {
  return named ? <Named c={c} meId={meId} /> : <>{holderOf(c, meId)}</>;
}

function Named({ c, meId }: { c: Conversation; meId: string }) {
  const members = useApiPages<MemberPage>(['members'], membersPath);
  const holder: string | null = c.assignedUserId; // null dropped by the generated type (CLAUDE.md)
  const all = members.data?.pages.flatMap((p) => p.data) ?? [];
  return <>{holderNameOf(all, holder, meId) ?? holderOf(c, meId)}</>;
}
