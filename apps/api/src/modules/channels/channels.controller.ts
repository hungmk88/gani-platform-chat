import { listChannels, listWorkspaces } from '@gani/db';
import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Query,
} from '@nestjs/common';

import { ZodPipe } from '../../openapi/zod-pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { mayInvite } from '../members/members.permissions.js';
import { currentRequestContext } from '../request-context/request-context.js';
import { ChannelListQuerySchema } from './channels.schemas.js';

/**
 * The channel accounts of a workspace, for /settings/teams to give a team its channels (A4, N161). An Owner or an Admin reads them
 * (Phụ lục B "Cài đặt workspace, kênh, team"). Metadata only: the secrets of a channel never leave the database through here.
 */
@Controller('v1/channels')
export class ChannelsController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get()
  async list(@Query(new ZodPipe(ChannelListQuerySchema)) q: { workspaceId: string }) {
    const ctx = currentRequestContext();
    if (!mayInvite(ctx.role)) throw new ForbiddenException();
    const data = await this.database.withTenant(ctx, async (tx) => {
      if (!(await listWorkspaces(tx)).some((w) => w.id === q.workspaceId))
        throw new NotFoundException();
      return listChannels(tx, q.workspaceId);
    });
    return { data };
  }
}
