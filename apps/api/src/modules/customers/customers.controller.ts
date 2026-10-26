import { InvalidCursorError, listCustomers, loadCustomer, type TenantTx } from '@gani/db';
import { phonePrefix } from '@gani/domain';
import { Controller, Get, Inject, NotFoundException, Param, Query } from '@nestjs/common';

import { ValidationFailedError, ZodPipe } from '../../openapi/zod-pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { currentRequestContext, type RequestContext } from '../request-context/request-context.js';
import { seesCustomersMasked } from './customers.permissions.js';
import {
  CustomerIdSchema,
  CustomerListQuerySchema,
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
    // A masked role does not search by phone: it could otherwise test whether a number is a customer's.
    const prefix = q.q === undefined || masked ? null : phonePrefix(q.q);
    const page = await this.read(ctx, (tx) =>
      listCustomers(tx, {
        limit: q.limit,
        ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
        ...(prefix !== null ? { phonePrefix: prefix } : q.q === undefined ? {} : { name: q.q }),
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
