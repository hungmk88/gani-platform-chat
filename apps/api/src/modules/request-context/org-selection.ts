import type { MemberContext } from '@gani/db';

import type { ResolvedSession } from './session-resolver.js';

// Which organisation a signed-in person acts in (N91), for every way in: the tenant middleware of /v1 and the handshake of the
// socket (realtime spec §2 step 4). One function, so the two can never drift apart (the lesson of TWO_FACTOR_SETUP_ROUTES).

export interface OrganisationSources {
  /** Organisations in which the person is an active member (auth pool: no tenant context exists yet). */
  organisations(userId: string): Promise<readonly string[]>;
  /** Role and workspaces in `orgId`, or `null` when the person is not an active member of it. Throws when the database fails. */
  member(orgId: string, userId: string): Promise<MemberContext | null>;
}

/** The Nest token of the one `OrganisationSources` of the application (RequestContextModule): /v1, the socket and `GET /v1/me`. */
export const ORGANISATION_SOURCES = Symbol('OrganisationSources');

export type OrganisationRefusal = 'no_organisation' | 'org_not_selected';

export type OrganisationChoice =
  | { readonly orgId: string; readonly member: MemberContext }
  | { readonly refused: OrganisationRefusal };

/** What each refusal says to the person (P9 problem `detail`). */
export const ORGANISATION_REFUSALS: Readonly<Record<OrganisationRefusal, string>> = {
  no_organisation: 'You are not a member of any organisation.',
  org_not_selected: 'Choose an organisation first.',
};

/**
 * The organisation the session has chosen, if the person is still an active member of it; otherwise the only one they are an active
 * member of; several is `org_not_selected` and none is `no_organisation`. Never from the request. A database that fails throws:
 * the caller answers that as "unavailable", never as a refusal.
 */
export async function chooseOrganisation(
  sources: OrganisationSources,
  session: Pick<ResolvedSession, 'userId' | 'activeOrgId'>,
): Promise<OrganisationChoice> {
  if (session.activeOrgId) {
    const member = await sources.member(session.activeOrgId, session.userId);
    if (member) return { orgId: session.activeOrgId, member };
  }
  const [only, ...others] = await sources.organisations(session.userId);
  if (only === undefined) return { refused: 'no_organisation' };
  if (others.length > 0) return { refused: 'org_not_selected' };
  const member = await sources.member(only, session.userId);
  return member ? { orgId: only, member } : { refused: 'no_organisation' };
}
