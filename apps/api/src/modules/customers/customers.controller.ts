import {
  insertAuditLog,
  InvalidCursorError,
  listCustomers,
  loadCustomer,
  updateCustomer,
  type CustomerChange,
  type TenantTx,
} from '@gani/db';
import { toE164, uuidv7 } from '@gani/domain';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Query,
} from '@nestjs/common';

import { ValidationFailedError, ZodPipe } from '../../openapi/zod-pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { currentRequestContext, type RequestContext } from '../request-context/request-context.js';
import { searchOf } from './customer-search.js';
import { mayEditCustomers, seesCustomersMasked } from './customers.permissions.js';
import {
  CustomerChangeSchema,
  CustomerIdSchema,
  CustomerListQuerySchema,
  type CustomerChangeBody,
  type CustomerListQuery,
} from './customers.schemas.js';
import { customerView } from './customers.view.js';

/**
 * The customers of the organisation (J1, Brief P9, N165): every role reads them, Marketing and Viewer with the phone and the email
 * masked (Phụ lục B). One customer belongs to the whole company, so the list is not narrowed by workspace. A customer of another
 * organisation is a 404, as row-level security hides it.
 */
@Controller('v1/customers')
export class CustomersController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get()
  async list(@Query(new ZodPipe(CustomerListQuerySchema)) q: CustomerListQuery) {
    const ctx = currentRequestContext();
    const masked = seesCustomersMasked(ctx.role);
    const page = await this.read(ctx, (tx) =>
      listCustomers(tx, {
        limit: q.limit,
        ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
        ...(q.q === undefined ? {} : searchOf(q.q, masked)),
      }),
    );
    return { data: page.rows.map((row) => customerView(row, masked)), nextCursor: page.nextCursor };
  }

  @Get(':id')
  async detail(@Param('id', new ZodPipe(CustomerIdSchema)) id: string) {
    const ctx = currentRequestContext();
    const row = await this.read(ctx, (tx) => loadCustomer(tx, id));
    if (!row) throw new NotFoundException();
    return customerView(row, seesCustomersMasked(ctx.role));
  }

  /**
   * Change a profile (Phụ lục B "Sửa hồ sơ khách": Owner to Support). The audit row names the fields that changed, never their values
   * (a name, a phone and an email are personal data).
   */
  @Patch(':id')
  async change(
    @Param('id', new ZodPipe(CustomerIdSchema)) id: string,
    @Body(new ZodPipe(CustomerChangeSchema)) body: CustomerChangeBody,
  ) {
    const ctx = currentRequestContext();
    if (!mayEditCustomers(ctx.role)) throw new ForbiddenException();
    const change = changeOf(body);
    const row = await this.database.withTenant(ctx, async (tx) => {
      if (!(await updateCustomer(tx, id, change))) return null;
      await insertAuditLog(tx, {
        id: uuidv7(),
        actorUserId: ctx.userId,
        action: 'customer.updated',
        targetType: 'customer',
        targetId: id,
        detail: { fields: Object.keys(body).sort().join(',') },
      });
      return loadCustomer(tx, id);
    });
    if (!row) throw new NotFoundException();
    return customerView(row, false);
  }

  /** One read-only transaction of the session; a cursor this API did not give is the client's mistake (400), not a 500. */
  private async read<T>(ctx: RequestContext, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    try {
      return await this.database.withTenant(ctx, fn);
    } catch (error) {
      if (error instanceof InvalidCursorError) throw new ValidationFailedError(['cursor: invalid']);
      throw error;
    }
  }
}

/** The body as the store takes it: the phone in E.164 (400 when it is not a whole number), the email in lower case. */
function changeOf(body: CustomerChangeBody): CustomerChange {
  let phoneE164: string | null | undefined = body.phone;
  if (typeof body.phone === 'string') {
    phoneE164 = toE164(body.phone);
    if (phoneE164 === null) throw new ValidationFailedError(['phone']);
  }
  return {
    ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
    ...(phoneE164 === undefined ? {} : { phoneE164 }),
    ...(body.email === undefined ? {} : { email: body.email?.toLowerCase() ?? null }),
    ...(body.humanOnly === undefined ? {} : { humanOnly: body.humanOnly }),
  };
}
