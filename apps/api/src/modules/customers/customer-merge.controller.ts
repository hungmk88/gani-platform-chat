import {
  insertAuditLog,
  listCustomerMerges,
  liveWorkspaceIds,
  loadCustomer,
  loadCustomerForUnmerge,
  loadCustomerMerge,
  mergeCustomers,
  unmergeCustomer,
  type CustomerMergeRecord,
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
  Post,
} from '@nestjs/common';

import { ZodPipe } from '../../openapi/zod-pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { Idempotent } from '../idempotency/idempotency.interceptor.js';
import { currentRequestContext, type RequestContext } from '../request-context/request-context.js';
import { mergeHttpErrorOf } from './customer-merge.errors.js';
import { CustomerMergeSchema, type CustomerMergeBody } from './customer-merge.schemas.js';
import { mayMergeCustomers, mayUnmergeCustomers } from './customers.permissions.js';
import { CustomerIdSchema } from './customers.schemas.js';
import { customerView } from './customers.view.js';

const recordView = (r: CustomerMergeRecord) => ({
  id: r.id,
  sourceId: r.sourceId,
  targetId: r.targetId,
  mergedBy: { ...r.mergedBy },
  mergedAt: r.mergedAt.toISOString(),
  unmergedAt: r.unmergedAt?.toISOString() ?? null,
});

/**
 * The merge of duplicate customers (J3c; contract J3-0, N197, N204, N205, N206). The role is checked before anything is read. A merge
 * or an unmerge moves rows of every live workspace of the organisation, not only the caller's (N204), so it runs in a transaction
 * that names them all; the merge store does the rest (J3b).
 */
@Controller('v1/customers')
export class CustomerMergeController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  /** Owner, Admin, Manager. */
  @Post('merge')
  @HttpCode(200)
  @Idempotent()
  async merge(@Body(new ZodPipe(CustomerMergeSchema)) body: CustomerMergeBody) {
    const ctx = currentRequestContext();
    if (!mayMergeCustomers(ctx.role)) throw new ForbiddenException();
    return this.acrossWorkspaces(ctx, async (tx) => {
      const { mergeId } = await mergeCustomers(tx, {
        sourceId: body.sourceId,
        targetId: body.targetId,
        actorUserId: ctx.userId,
        newId: uuidv7,
      });
      const merge = await loadCustomerMerge(tx, mergeId);
      const target = await loadCustomer(tx, body.targetId);
      if (merge === null || target === null) throw new Error('the merge just written is gone');
      return { merge: recordView(merge), target: customerView(target, false) };
    });
  }

  /**
   * Owner, Admin. The target may have been soft deleted since the merge (N205): the unmerge still runs, the answer still carries it
   * whole, and the audit says so (`customer.unmerged_from_deleted_target`, ids only; CEO 07/11/2026).
   */
  @Post(':id/unmerge')
  @HttpCode(200)
  @Idempotent()
  async unmerge(@Param('id', new ZodPipe(CustomerIdSchema)) id: string) {
    const ctx = currentRequestContext();
    if (!mayUnmergeCustomers(ctx.role)) throw new ForbiddenException();
    return this.acrossWorkspaces(ctx, async (tx) => {
      const { mergeId, targetId } = await unmergeCustomer(tx, {
        sourceId: id,
        actorUserId: ctx.userId,
        newId: uuidv7,
      });
      const merge = await loadCustomerMerge(tx, mergeId);
      const source = await loadCustomerForUnmerge(tx, id);
      const target = await loadCustomerForUnmerge(tx, targetId);
      if (merge === null || source === null || target === null)
        throw new Error('the unmerge just written is gone');
      if (target.deleted)
        await insertAuditLog(tx, {
          id: uuidv7(),
          actorUserId: ctx.userId,
          action: 'customer.unmerged_from_deleted_target',
          targetType: 'customer',
          targetId,
          detail: { sourceId: id, targetId },
        });
      return {
        merge: recordView(merge),
        source: customerView(source.customer, false),
        target: customerView(target.customer, false),
      };
    });
  }

  /** Owner, Admin (N206: not Manager, though a Manager merges). The merges into this live customer, newest first, undone ones too. */
  @Get(':id/merges')
  async merges(@Param('id', new ZodPipe(CustomerIdSchema)) id: string) {
    const ctx = currentRequestContext();
    if (!mayUnmergeCustomers(ctx.role)) throw new ForbiddenException();
    const rows = await this.database.withTenant(ctx, async (tx) =>
      (await loadCustomer(tx, id)) === null ? null : listCustomerMerges(tx, id),
    );
    if (rows === null) throw new NotFoundException();
    return { data: rows.map((r) => ({ ...recordView(r), sourceName: r.sourceName })) };
  }

  /**
   * Two transactions (N204, N206): the first reads the live workspaces of the organisation (RLS by org), the second acts with all of
   * them, so the tenant context of the store matches the GUC. A workspace made between the two is not reached: rows of the source
   * in it stay with the source (an unmerge cannot give back what never moved), and merging again moves them. Known limit, accepted
   * by the CEO on 07/11/2026; no SERIALIZABLE or lock on every workspace for a window of milliseconds.
   */
  private async acrossWorkspaces<T>(
    ctx: RequestContext,
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T> {
    try {
      const workspaceIds = await this.database.withTenant(ctx, liveWorkspaceIds);
      return await this.database.withTenant({ ...ctx, workspaceIds }, fn);
    } catch (error) {
      throw mergeHttpErrorOf(error);
    }
  }
}
