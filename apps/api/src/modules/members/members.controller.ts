import {
  createMemberInvite,
  InvalidCursorError,
  listMembers,
  insertAuditLog,
  loadMember,
  lockActiveOwners,
  lockMember,
  lockPendingInvite,
  newInviteToken,
  readOrgSummary,
  renewMemberInvite,
  resetMemberTwoFactor,
  updateMemberRole,
  type OrgRole,
  type PendingInvite,
  type TenantTx,
} from '@gani/db';
import { uuidv7 } from '@gani/domain';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { ValidationFailedError, ZodPipe } from '../../openapi/zod-pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { Idempotent } from '../idempotency/idempotency.interceptor.js';
import { currentRequestContext, type RequestContext } from '../request-context/request-context.js';
import { InviteMailer } from './invite-mailer.js';
import { mayInvite, mayResetTwoFactor, roleChangeRefusal } from './members.permissions.js';
import {
  InviteBodySchema,
  MemberIdSchema,
  MemberListQuerySchema,
  RoleBodySchema,
  TwoFactorResetBodySchema,
} from './members.schemas.js';
import { memberView } from './members.view.js';

/** 409 of an email this organisation has invited already: one pending invitation per person, which resend-invite renews. */
export class DuplicateInviteError extends Error {
  readonly status = 409;
  readonly code = 'duplicate_resource';
  constructor() {
    super('This email has a pending invitation already.');
    this.name = 'DuplicateInviteError';
  }
}

/** 409 when the change would leave the organisation without an active Owner (N154): two Owners demoting each other at once. */
export class LastOwnerError extends Error {
  readonly status = 409;
  readonly code = 'last_owner';
  constructor() {
    super('The organisation must keep an active Owner.');
    this.name = 'LastOwnerError';
  }
}

/** 409 when the person is also a member of another organisation or a platform operator (N155): one company cannot lower that account. */
export class SharedAccountError extends Error {
  readonly status = 409;
  readonly code = 'shared_account';
  constructor() {
    super('This person belongs to another organisation too; ask a platform operator.');
    this.name = 'SharedAccountError';
  }
}

/**
 * Invitations of members (Brief P9 `POST /v1/members/invite`, Phụ lục B, N152). Each is one TenantTx: the row of org_members with the
 * SHA-256 of a new token and an audit row (no email in it), then, after the commit, the email with the token. A failed email leaves the
 * invitation and answers `emailSent: false`: resend-invite sends a new token. Both require an Idempotency-Key, so a retried request
 * gets the first answer and no second email.
 */
@Controller('v1/members')
export class MembersController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(InviteMailer) private readonly mailer: InviteMailer,
  ) {}

  /**
   * The members and pending invitations of the organisation, with their email (#19, N153). Only an Owner or an Admin: the email is
   * PII, and N12 leaves the check of the role to the service, before app.org_member_directory is read.
   */
  @Get()
  async list(
    @Query(new ZodPipe(MemberListQuerySchema)) q: { cursor?: string | undefined; limit: number },
  ) {
    const ctx = currentRequestContext();
    if (!mayInvite(ctx.role)) throw new ForbiddenException();
    try {
      const page = await this.database.withTenant(ctx, (tx) =>
        listMembers(tx, {
          limit: q.limit,
          ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
        }),
      );
      const now = new Date();
      return { data: page.rows.map((row) => memberView(row, now)), nextCursor: page.nextCursor };
    } catch (error) {
      if (error instanceof InvalidCursorError) throw new ValidationFailedError(['cursor: invalid']);
      throw error;
    }
  }

  /**
   * The role of a member (Brief P9, N154). One TenantTx: the active Owners locked first, then the member, so that two changes at once
   * take turns and the organisation always keeps an Owner; audited with the two roles, no email. Setting a role twice changes nothing
   * the second time, so no Idempotency-Key. The person's next request acts in the new role; their socket within 60 s (revalidate).
   */
  @Patch(':id/role')
  async changeRole(
    @Param('id', new ZodPipe(MemberIdSchema)) id: string,
    @Body(new ZodPipe(RoleBodySchema)) body: { role: OrgRole },
  ) {
    const ctx = currentRequestContext();
    if (!mayInvite(ctx.role)) throw new ForbiddenException();
    const member = await this.database.withTenant(ctx, async (tx) => {
      const ownerIds = await lockActiveOwners(tx);
      const target = await lockMember(tx, id);
      if (!target) throw new NotFoundException();
      const refusal = roleChangeRefusal(ctx, target, body.role, ownerIds);
      if (refusal === 'forbidden') throw new ForbiddenException();
      if (refusal === 'last_owner') throw new LastOwnerError();
      if (target.role !== body.role) {
        await updateMemberRole(tx, id, body.role);
        await insertAuditLog(tx, {
          id: uuidv7(),
          actorUserId: ctx.userId,
          action: 'member.role_changed',
          targetType: 'org_member',
          targetId: id,
          detail: { from: target.role, to: body.role },
        });
      }
      return loadMember(tx, id);
    });
    if (!member) throw new NotFoundException();
    return memberView(member, new Date());
  }

  /**
   * Turns off the second factor of a member who lost it and ends every session of theirs (Q-U20-1, N155): an Owner or an Admin, not
   * their own, an Admin not an Owner's. One TenantTx: the member locked, the check, app.reset_member_two_factor, an audit row with the
   * reason (never a log). An Owner or an Admin must enrol again at the next sign-in (the 2FA gate); their socket ends within 60 s.
   */
  @Post(':id/2fa/reset')
  @HttpCode(200)
  @Idempotent()
  async resetTwoFactor(
    @Param('id', new ZodPipe(MemberIdSchema)) id: string,
    @Body(new ZodPipe(TwoFactorResetBodySchema)) body: { reason: string },
  ) {
    const ctx = currentRequestContext();
    if (!mayInvite(ctx.role)) throw new ForbiddenException();
    const member = await this.database.withTenant(ctx, async (tx) => {
      const target = await lockMember(tx, id);
      if (!target) throw new NotFoundException();
      if (!mayResetTwoFactor(ctx, target)) throw new ForbiddenException();
      const result = await resetMemberTwoFactor(tx, id);
      if (result === 'not_found') throw new NotFoundException();
      if (result === 'shared') throw new SharedAccountError();
      await insertAuditLog(tx, {
        id: uuidv7(),
        actorUserId: ctx.userId,
        action: 'member.two_factor_reset',
        targetType: 'org_member',
        targetId: id,
        detail: { reason: body.reason },
      });
      return loadMember(tx, id);
    });
    if (!member) throw new NotFoundException();
    return memberView(member, new Date());
  }

  @Post('invite')
  @HttpCode(201)
  @Idempotent()
  invite(@Body(new ZodPipe(InviteBodySchema)) body: { email: string; role: OrgRole }) {
    const ctx = currentRequestContext();
    if (!mayInvite(ctx.role, body.role)) throw new ForbiddenException();
    return this.issue(ctx, 'member.invited', async (tx, hash) => {
      const invite = await createMemberInvite(tx, {
        id: uuidv7(),
        email: body.email,
        role: body.role,
        invitedBy: ctx.userId,
        tokenHash: hash,
      });
      if (!invite) throw new DuplicateInviteError();
      return invite;
    });
  }

  /** A new token and seven more days for a pending invitation; the link sent before stops working. Same rule of roles as invite. */
  @Post(':id/resend-invite')
  @HttpCode(200)
  @Idempotent()
  resend(@Param('id', new ZodPipe(MemberIdSchema)) id: string) {
    const ctx = currentRequestContext();
    if (!mayInvite(ctx.role)) throw new ForbiddenException();
    return this.issue(ctx, 'member.invite_resent', async (tx, hash) => {
      const pending = await lockPendingInvite(tx, id);
      if (!pending) throw new NotFoundException();
      if (!mayInvite(ctx.role, pending.role)) throw new ForbiddenException();
      // Locked above, so it is still pending.
      return (await renewMemberInvite(tx, id, hash)) as PendingInvite;
    });
  }

  private async issue(
    ctx: RequestContext,
    action: string,
    write: (tx: TenantTx, tokenHash: Buffer) => Promise<PendingInvite>,
  ) {
    const { token, hash } = newInviteToken();
    const { invite, orgName } = await this.database.withTenant(ctx, async (tx) => {
      const invite = await write(tx, hash);
      await insertAuditLog(tx, {
        id: uuidv7(),
        actorUserId: ctx.userId,
        action,
        targetType: 'org_member',
        targetId: invite.id,
        detail: { role: invite.role },
      });
      const { org } = await readOrgSummary(tx, []);
      return { invite, orgName: org?.name ?? '' };
    });
    const emailSent = await this.mailer.send(orgName, invite, token);
    return {
      id: invite.id,
      email: invite.invitedEmail,
      role: invite.role,
      status: 'pending' as const,
      expiresAt: invite.expiresAt.toISOString(),
      emailSent,
    };
  }
}
