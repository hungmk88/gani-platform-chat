import type { IncomingMessage, ServerResponse } from 'node:http';

import { Controller, Get, Inject, Req, Res } from '@nestjs/common';

import { AuthService } from '../auth/auth.service.js';
import type { TwoFactorStatus } from '../auth/two-factor.js';
import { PROBLEM_CONTENT_TYPE, problem, type Problem } from './problem.js';
import { SessionResolver } from './session-resolver.js';

/**
 * `GET /v1/me/security-status`: what the client needs to know before it can do anything else: is a second factor required of this
 * person, is it on, and must it be set up now (N89 (6)). It needs a session, not an organisation, so the tenant middleware leaves
 * it out; the gate at the edge lets it through for a person who has not finished the set-up.
 */
@Controller('v1/me')
export class MeController {
  constructor(
    @Inject(SessionResolver) private readonly sessions: SessionResolver,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

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
    return problem(401, 'UNAUTHENTICATED', 'Sign in first.');
  }
}
