// #378 A1–A6: who the admin offers a screen, a button or a field to follows the API's own rules, read from its source, never
// copied here (the five buttons of an open conversation are in inbox/rules-sync.test.ts).
// Why an admin test imports apps/api: these permission files belong to the BE and carry no note of this test.
// - Red at an import (a file moved or was renamed): fix the import path. First read `git log --follow -p` of that file: if it
//   also changed its content in the same move, the comparisons below have not run yet, so check the rules as well.
// - Red at a comparison: the API's rule changed. Change the FE rule to match, never this test (A3 says more).
// apps/admin/turbo.json lists every file this test reads outside the admin, so that turbo's cache never hides a change.
import { describe, expect, it } from 'vitest';

import { ANSWERABLE, mayAct, readScope } from '../../api/src/modules/conversations/permissions';
import {
  mayEditCustomers as apiMayEditCustomers,
  seesCustomersMasked,
} from '../../api/src/modules/customers/customers.permissions';
import {
  mayInvite,
  mayResetTwoFactor,
  roleChangeRefusal,
} from '../../api/src/modules/members/members.permissions';
import {
  mayReadQuickReplies,
  mayWriteQuickReplies,
} from '../../api/src/modules/quick-replies/quick-replies.permissions';
import { CONVERSATION_STATES } from '../../../packages/domain/src/conversation/types';
import { mayEditCustomers } from './customers/customer-edit';
import { seesMasked } from './customers/customers';
import { readsConversations } from './inbox/actions';
import { canReply } from './inbox/composer';
import { invitableRoles } from './members/invite';
import { canChangeRole, canResend, canResetTwoFactor, canSetCapacity } from './members/list';
import { navFor } from './nav';
import { mayManageQuickReplies } from './quick-replies/quick-replies';

type OrgRole = Parameters<typeof readScope>[0];

// Names only, no rule: a role the API adds makes typecheck fail here.
const ROLES = Object.keys({
  owner: true,
  admin: true,
  manager: true,
  sales: true,
  support: true,
  marketing: true,
  viewer: true,
} satisfies Record<OrgRole, true>) as OrgRole[];
const ME = 'user-me';
const HOLDERS = [ME, 'user-other', null] as const;
const inMenu = (role: OrgRole, href: string) =>
  navFor(role).some((g) => g.items.some((i) => i.href === href));

/** Every role whose FE answer differs from the API's, as `role: fe=… api=…`. */
const disagree = (fe: (r: OrgRole) => boolean, api: (r: OrgRole) => boolean) =>
  ROLES.filter((r) => fe(r) !== api(r)).map((r) => `${r}: fe=${fe(r)} api=${api(r)}`);

describe('the admin offers what the API allows (permission files of apps/api, #378 A1–A6)', () => {
  it('A1 the reply box: role × state × holder as send_message and ANSWERABLE of permissions.ts', () => {
    // The API takes a reply when mayAct lets the person send and the state is one of ANSWERABLE (send-message.controller.ts;
    // exported for this test, U59).
    const wrong = ROLES.flatMap((role) =>
      CONVERSATION_STATES.flatMap((state) =>
        HOLDERS.flatMap((assignedUserId) => {
          const c = { state, assignedUserId };
          const fe = canReply(c, role, ME);
          const api = mayAct(role, ME, 'send_message', c) && ANSWERABLE.has(state);
          return fe === api
            ? []
            : [`${role} ${state} holder=${assignedUserId ?? 'none'}: fe=${fe} api=${api}`];
        }),
      ),
    );
    expect(wrong, 'change canReply (inbox/composer.ts)').toEqual([]);
  });

  it('A2 the Inbox, its menu item and its realtime: the roles readScope lets read', () => {
    const api = (r: OrgRole) => readScope(r) !== 'none';
    expect(disagree(readsConversations, api), 'change readsConversations').toEqual([]);
    expect(
      disagree((r) => inMenu(r, '/inbox'), api),
      'change the menu (nav.ts)',
    ).toEqual([]);
  });

  it('A3 Sales and Support read only their own and the unclaimed ones', () => {
    // This guards a behaviour the screen relies on, not a rule of its own: after "Chuyển" a Sales or Support leaves the
    // conversation for /inbox (conversation-view.tsx), because they can no longer read it. If S4 widens reading (by team) and
    // this goes red, do NOT make it green as it is: first look again at that move to /inbox, then change this test.
    expect(readScope('sales')).toBe('mine_or_unassigned');
    expect(readScope('support')).toBe('mine_or_unassigned');
  });

  it('A4 members: inviting, sending again, changing a role, resetting 2FA, setting the load limit', () => {
    const wrong: string[] = [];
    // last_owner is the API's decision at run time (409), not a rule the FE mirrors; the FE checks nothing about it before
    // sending (members/list.ts only words the 409). If the FE ever blocks it before sending, check that here too.
    const owners = ['m-owner-1', 'm-owner-2'];
    for (const actor of ROLES) {
      for (const role of ROLES) {
        const invites = invitableRoles(actor).includes(role);
        if (invites !== mayInvite(actor, role))
          wrong.push(`invite ${actor}→${role}: fe=${invites} api=${mayInvite(actor, role)}`);
        const resend = canResend(actor, { status: 'pending', role });
        if (resend !== mayInvite(actor, role))
          wrong.push(`resend ${actor}→${role}: fe=${resend} api=${mayInvite(actor, role)}`);
        for (const self of [true, false]) {
          const userId = self ? ME : 'user-other';
          const member = { status: 'active', role, userId, twoFactorEnabled: true } as const;
          const target = { id: 'm-target', userId, role };
          // The dialog offers invitableRoles(actor): the button shows when some role may be given, and each one offered may.
          const offered = invitableRoles(actor);
          const allowed = offered.filter(
            (to) =>
              roleChangeRefusal({ userId: ME, role: actor }, target, to, owners) !== 'forbidden',
          );
          const button = canChangeRole(actor, ME, member);
          if (button !== allowed.length > 0 || (button && allowed.length !== offered.length))
            wrong.push(
              `role ${actor}→${role} self=${self}: fe=${button} api=${allowed.join('|') || 'none'}`,
            );
          const reset = canResetTwoFactor(actor, ME, member);
          const apiReset = mayResetTwoFactor({ userId: ME, role: actor }, { userId, role });
          if (reset !== apiReset)
            wrong.push(`2fa ${actor}→${role} self=${self}: fe=${reset} api=${apiReset}`);
        }
      }
      // PATCH /v1/members/{id}/capacity asks mayInvite(ctx.role) (members.controller.ts), anyone with an account, oneself too.
      for (const self of [true, false]) {
        const fe = canSetCapacity(actor, { status: 'active', userId: self ? ME : 'user-other' });
        if (fe !== mayInvite(actor))
          wrong.push(`capacity ${actor} self=${self}: fe=${fe} api=${mayInvite(actor)}`);
      }
    }
    expect(wrong, 'change members/invite.ts or members/list.ts').toEqual([]);
  });

  it('A5 customers: who edits a profile, who gets phones and emails masked', () => {
    expect(disagree(mayEditCustomers, apiMayEditCustomers), 'change mayEditCustomers').toEqual([]);
    expect(disagree(seesMasked, seesCustomersMasked), 'change seesMasked').toEqual([]);
  });

  it('A6 quick replies: who manages them, and every role with a reply box reads them', () => {
    expect(
      disagree(mayManageQuickReplies, mayWriteQuickReplies),
      'change mayManageQuickReplies',
    ).toEqual([]);
    expect(
      disagree((r) => inMenu(r, '/settings/quick-replies'), mayWriteQuickReplies),
      'change the menu (nav.ts)',
    ).toEqual([]);
    // A relation, not one function against another: for every role, a reply box (which lists the templates on "/") implies
    // the API lets that role read the templates. A role with no reply box may read them or not.
    const replies = (r: OrgRole) =>
      HOLDERS.some((assignedUserId) => canReply({ state: 'HUMAN_ACTIVE', assignedUserId }, r, ME));
    const unread = ROLES.filter((r) => replies(r) && !mayReadQuickReplies(r));
    expect(
      unread,
      'a role answers customers but cannot read the templates of its reply box',
    ).toEqual([]);
  });
});
