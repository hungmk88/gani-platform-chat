// #378: the buttons of an open conversation follow the API's own rules, read from its source, never copied here.
// - Who may act: `mayAct` of apps/api permissions.ts (Phụ lục B rows 13–17).
// - From which state: the transition rows of TRANSITIONS in @gani/domain (FSM P14).
// Why an admin test imports apps/api: it checks that the API's rules and the FE's agree. permissions.ts belongs to the BE and
// carries no note of this test; whoever moves it learns from this test going red.
// - Red at an import (a file moved or was renamed): fix the import path. First read `git log --follow -p` of that file: if it
//   also changed its content in the same move, the comparison below has not run yet, so check the rules as well.
// - Red at the comparison (a role or a state added or removed, a guard added): that is what the test is for. Change the FE rule
//   (actionsFor, canTransfer, mayAssign/canAssign) to match, never this test.
// apps/admin/turbo.json lists every file this test reads outside the admin, so that turbo's cache never hides a change.
import { describe, expect, it } from 'vitest';

import {
  mayAct,
  type ConversationAction,
} from '../../../api/src/modules/conversations/permissions';
import { TRANSITIONS } from '../../../../packages/domain/src/conversation/transitions';
import {
  CONVERSATION_STATES,
  type ConversationEventType,
} from '../../../../packages/domain/src/conversation/types';
import { actionsFor } from './actions';
import { canAssign, canTransfer, mayAssign } from './assign';

type OrgRole = Parameters<typeof mayAct>[0];
type Checked = Exclude<ConversationAction, 'send_message'>; // the reply box is not a button of this list

// Names only, no rule: a role or an action the API adds makes typecheck fail here.
const ROLES = Object.keys({
  owner: true,
  admin: true,
  manager: true,
  sales: true,
  support: true,
  marketing: true,
  viewer: true,
} satisfies Record<OrgRole, true>) as OrgRole[];
const EVENT = {
  claim: 'claim',
  wait_customer: 'agent_waits_customer',
  close: 'close',
  transfer: 'transfer',
  assign: 'reassign',
} as const satisfies Record<Checked, ConversationEventType>;
const ACTIONS = Object.keys(EVENT) as Checked[];
const ME = 'user-me';

const rowsOf = (a: Checked) => TRANSITIONS.filter((r) => 'history' in r && r.event === EVENT[a]);

/** What the FE offers: the same functions the screen calls. */
function offered(
  c: {
    state: (typeof CONVERSATION_STATES)[number];
    afterHoursHold: boolean;
    assignedUserId: string | null;
  },
  role: OrgRole,
): Set<Checked> {
  const out = new Set<Checked>(actionsFor(c, role, ME));
  if (canTransfer(c, role, ME)) out.add('transfer');
  if (mayAssign(role) && canAssign(c)) out.add('assign');
  return out;
}

describe('the conversation buttons follow the API rules (permissions.ts + TRANSITIONS, #378)', () => {
  it('no row of these actions has a guard the FE cannot see', () => {
    const guarded = ACTIONS.flatMap((a) =>
      rowsOf(a)
        .filter((r) => r.guard)
        .map((r) => `${a}: ${r.id}`),
    );
    expect(
      guarded,
      'luật có điều kiện mới (guard), xét lại FE: the FSM now refuses on facts the FE does not read',
    ).toEqual([]);
  });

  it('every role, state, after-hours flag and holder: the FE offers exactly what the API allows', () => {
    const wrong: string[] = [];
    for (const role of ROLES)
      for (const state of CONVERSATION_STATES)
        for (const afterHoursHold of [false, true])
          for (const assignedUserId of [ME, 'user-other', null]) {
            const c = { state, afterHoursHold, assignedUserId };
            const fe = offered(c, role);
            for (const a of ACTIONS) {
              const api =
                mayAct(role, ME, a, c) &&
                rowsOf(a).some(
                  (r) =>
                    r.from.includes(state) && (r.hold === undefined || r.hold === afterHoursHold),
                );
              if (api !== fe.has(a))
                wrong.push(
                  `${role} ${state} hold=${afterHoursHold} holder=${assignedUserId ?? 'none'} ${a}: api=${api} fe=${fe.has(a)}`,
                );
            }
          }
    expect(wrong, 'FE and API disagree; change the FE rule (actions.ts, assign.ts)').toEqual([]);
  });
});
