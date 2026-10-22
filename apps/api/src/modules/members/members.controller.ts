import {
  createMemberInvite,
  insertAuditLog,
  newInviteToken,
  readOrgSummary,
  type OrgRole,
  type PendingInvite,
  type TenantTx,
} from '@gani/db';
import { uuidv7 } from '@gani/domain';
import { Body, Controller, ForbiddenException, HttpCode, Inject, Post } from '@nestjs/common';

import { ZodPipe } from '../../openapi/zod-pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { Idempotent } from '../idempotency/idempotency.interceptor.js';
import { currentRequestContext, type RequestContext } from '../request-context/request-context.js';
import { InviteMailer } from './invite-mailer.js';
import { mayInvite } from './members.permissions.js';
import { InviteBodySchema } from './members.schemas.js';

/** 409 of an email this organisation has invited already: one pending invitation per person. */
export class DuplicateInviteError extends Error {
  readonly status = 409;
  readonly code = 'duplicate_resource';
  constructor() {
    super('This email has a pending invitation already.');
    this.name = 'DuplicateInviteError';
  }
}

/**
 * Invitations of members (Brief P9 `POST /v1/members/invite`, Phụ lục B, N152). One TenantTx: the row of org_members with the
 * SHA-256 of a new token and an audit row (no email in it), then, after the commit, the email with the token. A failed email leaves the
 * invitation and answers `emailSent: false`. An Idempotency-Key is required, so a retried request gets the first answer and no second
 * email.
 */
@Controller('v1/members')
export class MembersController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(InviteMailer) private readonly mailer: InviteMailer,
  ) {}

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
