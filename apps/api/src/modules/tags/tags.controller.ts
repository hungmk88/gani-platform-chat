import {
  createTag,
  insertAuditLog,
  listTags,
  lockTags,
  mergeTag,
  updateTag,
  type TagChange,
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
} from '@nestjs/common';

import { ValidationFailedError, ZodPipe } from '../../openapi/zod-pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { Idempotent } from '../idempotency/idempotency.interceptor.js';
import { currentRequestContext } from '../request-context/request-context.js';
import { tagHttpErrorOf } from './tags.errors.js';
import { mayManageTags } from './tags.permissions.js';
import { TagChangeSchema, TagCreateSchema, TagIdSchema, TagMergeSchema } from './tags.schemas.js';
import { tagView } from './tags.view.js';

/**
 * The tags of a company (J4, T-4/U47, N190; Tag 3a). Every role reads them; an Owner or an Admin makes, renames, hides or merges one.
 * A tag of another company is a 404, as row-level security hides it. Only a merge is audited (`tag.merged`, contract N190).
 */
@Controller('v1/tags')
export class TagsController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get()
  async list() {
    const rows = await this.database.withTenant(currentRequestContext(), listTags);
    return { data: rows.map(tagView) };
  }

  @Post()
  @HttpCode(201)
  @Idempotent()
  async create(@Body(new ZodPipe(TagCreateSchema)) body: { name: string }) {
    const ctx = managers();
    return tagView(await this.write(ctx, (tx) => createTag(tx, { id: uuidv7(), name: body.name })));
  }

  @Patch(':id')
  async change(
    @Param('id', new ZodPipe(TagIdSchema)) id: string,
    @Body(new ZodPipe(TagChangeSchema)) body: TagChange,
  ) {
    const ctx = managers();
    const row = await this.write(ctx, async (tx) => {
      if ((await lockTags(tx, [id])).length === 0) throw new NotFoundException();
      return updateTag(tx, id, body);
    });
    return tagView(row);
  }

  @Post(':id/merge')
  @HttpCode(200)
  async merge(
    @Param('id', new ZodPipe(TagIdSchema)) id: string,
    @Body(new ZodPipe(TagMergeSchema)) body: { intoTagId: string },
  ) {
    const ctx = managers();
    if (body.intoTagId === id) throw new ValidationFailedError(['intoTagId: the same tag']);
    return this.write(ctx, async (tx) => {
      if ((await lockTags(tx, [id, body.intoTagId])).length !== 2) throw new NotFoundException();
      const movedCount = await mergeTag(tx, id, body.intoTagId);
      await insertAuditLog(tx, {
        id: uuidv7(),
        actorUserId: ctx.userId,
        action: 'tag.merged',
        targetType: 'tag',
        targetId: id,
        detail: { intoTagId: body.intoTagId, movedCount },
      });
      const [into] = await lockTags(tx, [body.intoTagId]);
      return { movedCount, into: tagView(into!) };
    });
  }

  private async write<T>(
    ctx: ReturnType<typeof currentRequestContext>,
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.database.withTenant(ctx, fn);
    } catch (error) {
      throw tagHttpErrorOf(error);
    }
  }
}

/** The request context of an Owner or an Admin; 403 for any other role. */
function managers() {
  const ctx = currentRequestContext();
  if (!mayManageTags(ctx.role)) throw new ForbiddenException();
  return ctx;
}
