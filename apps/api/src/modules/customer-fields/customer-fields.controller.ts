import {
  createField,
  deleteField,
  insertAuditLog,
  listFields,
  lockField,
  updateField,
  type FieldRow,
  type FieldType,
  type TenantTx,
} from '@gani/db';
import { uuidv7 } from '@gani/domain';
import {
  Body,
  Controller,
  Delete,
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
import { currentRequestContext, type RequestContext } from '../request-context/request-context.js';
import { fieldHttpErrorOf } from './customer-fields.errors.js';
import { mayManageFields } from './customer-fields.permissions.js';
import {
  CustomerFieldChangeSchema,
  CustomerFieldCreateSchema,
  CustomerFieldIdSchema,
} from './customer-fields.schemas.js';
import { fieldView } from './customer-fields.view.js';

type Create = {
  name: string;
  type: FieldType;
  options?: string[];
  required: boolean;
  sensitive: boolean;
};
type Change = Partial<Omit<Create, 'options'>> & {
  options?: string[];
  hidden?: boolean;
  position?: number;
};
const choosing = (type: FieldType) => type === 'select' || type === 'multiselect';

/**
 * The custom fields of a company (J1, N191; Tag 3b-ii): every role reads them, an Owner or an Admin defines, changes or ends one, each
 * write audited (`customer_field.created`, `.updated {fields}`, `.deleted`; names of the fields changed, never their values). A field
 * of another company is a 404, as row-level security hides it. The contract is the one planned for S4, moved as it was (Tầng 2).
 */
@Controller('v1/customer-fields')
export class CustomerFieldsController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get()
  async list() {
    const rows = await this.database.withTenant(currentRequestContext(), listFields);
    return { data: rows.map(fieldView) };
  }

  @Post()
  @HttpCode(201)
  async create(@Body(new ZodPipe(CustomerFieldCreateSchema)) body: Create) {
    const ctx = managers();
    const row = await this.write(ctx, async (tx) => {
      const made = await createField(tx, { id: uuidv7(), ...body, options: body.options ?? [] });
      await audit(tx, ctx, 'customer_field.created', made.id, { type: made.type });
      return made;
    });
    return fieldView(row);
  }

  @Patch(':id')
  async change(
    @Param('id', new ZodPipe(CustomerFieldIdSchema)) id: string,
    @Body(new ZodPipe(CustomerFieldChangeSchema)) body: Change,
  ) {
    const ctx = managers();
    const row = await this.write(ctx, async (tx) => {
      const current = await locked(tx, id);
      // Choices go with select and multiselect only: a new type of one keeps the old choices if it had some, another clears them.
      const type = body.type ?? current.type;
      const options =
        body.options ?? (choosing(type) && choosing(current.type) ? [...current.options] : []);
      if (!choosing(type) && body.options !== undefined)
        throw new ValidationFailedError(['options: only for select and multiselect']);
      if (choosing(type) && options.length < 2)
        throw new ValidationFailedError(['options: at least two for select and multiselect']);
      const next = await updateField(tx, current, {
        ...body,
        ...(body.type === undefined && body.options === undefined ? {} : { options }),
      });
      await audit(tx, ctx, 'customer_field.updated', id, { fields: Object.keys(body).join(',') });
      return next;
    });
    return fieldView(row);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', new ZodPipe(CustomerFieldIdSchema)) id: string) {
    const ctx = managers();
    await this.write(ctx, async (tx) => {
      await deleteField(tx, await locked(tx, id));
      await audit(tx, ctx, 'customer_field.deleted', id, {});
    });
  }

  private async write<T>(ctx: RequestContext, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    try {
      return await this.database.withTenant(ctx, fn);
    } catch (error) {
      throw fieldHttpErrorOf(error);
    }
  }
}

/** The live field `id`, locked; 404 when it is not of the company. */
async function locked(tx: TenantTx, id: string): Promise<FieldRow> {
  const row = await lockField(tx, id);
  if (!row) throw new NotFoundException();
  return row;
}

function audit(
  tx: TenantTx,
  ctx: RequestContext,
  action: string,
  targetId: string,
  detail: Readonly<Record<string, string>>,
) {
  return insertAuditLog(tx, {
    id: uuidv7(),
    actorUserId: ctx.userId,
    action,
    targetType: 'customer_field',
    targetId,
    detail,
  });
}

/** The request context of an Owner or an Admin; 403 for any other role. */
function managers() {
  const ctx = currentRequestContext();
  if (!mayManageFields(ctx.role)) throw new ForbiddenException();
  return ctx;
}
