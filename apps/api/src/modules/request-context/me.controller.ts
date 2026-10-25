import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { readOrgSummary, type OrgRole } from '@gani/db';
import { Body, Controller, Get, Inject, Logger, Patch, Req, Res } from '@nestjs/common';

import { AuthService } from '../auth/auth.service.js';
import type { TwoFactorStatus } from '../auth/two-factor.js';
import { ZodPipe } from '../../openapi/zod-pipe.js';
import { DatabaseService, errorCode } from '../database/database.service.js';
import {
  chooseOrganisation,
  ORGANISATION_SOURCES,
  type OrganisationSources,
} from './org-selection.js';
import { MeChangeSchema } from './me.schemas.js';
import { PROBLEM_CONTENT_TYPE, problem, type Problem } from './problem.js';
import { SessionResolver } from './session-resolver.js';

/** `GET /v1/me` (U32, N145): who is signed in, the organisation they act in (or `null`) and its workspaces they may enter. */
export interface Me {
  readonly id: string;
  readonly name: string;
  readonly isPlatformOperator: boolean;
  readonly org: { readonly id: string; readonly name: string; readonly role: OrgRole } | null;
  readonly workspaces: readonly { readonly id: string; readonly name: string }[];
}

/**
 * The two routes under /v1 that need a session, not an organisation, so the tenant middleware leaves them out:
 * - `GET /v1/me/security-status`: is a second factor required of this person, is it on, and must it be set up now (N89 (6)); the
 *   gate at the edge lets it through for a person who has not finished the set-up.
 * - `GET /v1/me`: the shell of the application asks it after the one above (the gate refuses it until 2FA is set up). A person with
 *   no organisation, or several and none chosen, is `org: null`: the organisation is chosen as for every /v1 route
 *   (`chooseOrganisation`), never from the request. `PATCH /v1/me` (same path) changes the person's own name (N162): a name belongs
 *   to the person, not to an organisation, so a platform operator of none renames themselves too.
 */
@Controller('v1/me')
export class MeController {
  private readonly logger = new Logger(MeController.name);

  constructor(
    @Inject(SessionResolver) private readonly sessions: SessionResolver,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ORGANISATION_SOURCES) private readonly organisations: OrganisationSources,
  ) {}

  @Get()
  async me(
    @Req() req: IncomingMessage,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<Me | Problem> {
    const traceId = randomUUID();
    const refuse = (status: number, code: string, detail: string): Problem => {
      res.statusCode = status;
      res.setHeader('content-type', PROBLEM_CONTENT_TYPE);
      return problem(status, code, detail, traceId);
    };
    try {
      const session = await this.sessions.resolve(req);
      const profile = session ? await this.auth.profile(session.userId) : null;
      if (!session || !profile) return refuse(401, 'unauthorized', 'Sign in first.');
      const choice = await chooseOrganisation(this.organisations, session);
      if ('refused' in choice) return { id: session.userId, ...profile, org: null, workspaces: [] };
      const { workspaceIds, role } = choice.member;
      const summary = await this.database.withTenant({ orgId: choice.orgId, workspaceIds }, (tx) =>
        readOrgSummary(tx, workspaceIds),
      );
      return {
        id: session.userId,
        ...profile,
        org: summary.org ? { ...summary.org, role } : null,
        workspaces: summary.org ? summary.workspaces : [],
      };
    } catch (error) {
      this.logger.warn(
        `me failed (${error instanceof Error ? errorCode(error) : 'unknown'}) trace=${traceId}`,
      );
      return refuse(503, 'service_unavailable', 'The service cannot answer right now. Try again.');
    }
  }

  @Patch()
  async rename(
    @Req() req: IncomingMessage,
    @Res({ passthrough: true }) res: ServerResponse,
    @Body(new ZodPipe(MeChangeSchema)) body: { name: string },
  ): Promise<Me | Problem> {
    const traceId = randomUUID();
    let renamed: boolean;
    try {
      const session = await this.sessions.resolve(req);
      renamed = session ? await this.auth.rename(session.userId, body.name) : false;
    } catch (error) {
      this.logger.warn(
        `rename failed (${error instanceof Error ? errorCode(error) : 'unknown'}) trace=${traceId}`,
      );
      res.statusCode = 503;
      res.setHeader('content-type', PROBLEM_CONTENT_TYPE);
      return problem(
        503,
        'service_unavailable',
        'The service cannot answer right now. Try again.',
        traceId,
      );
    }
    if (renamed) return this.me(req, res);
    res.statusCode = 401;
    res.setHeader('content-type', PROBLEM_CONTENT_TYPE);
    return problem(401, 'unauthorized', 'Sign in first.', traceId);
  }

  @Get('security-status')
  async securityStatus(
    @Req() req: IncomingMessage,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<TwoFactorStatus | Problem> {
    const session = await this.sessions.resolve(req);
    const status = session ? await this.auth.twoFactorStatus(session.userId) : null;
    if (status) return status;
    res.statusCode = 401;
    res.setHeader('content-type', PROBLEM_CONTENT_TYPE);
    return problem(401, 'unauthorized', 'Sign in first.');
  }
}
