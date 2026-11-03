import { SecretBox, SecretDecryptError } from '@gani/channels';
import {
  FIELD_VALUE_COLUMN,
  insertAuditLog,
  readFieldValues,
  setFieldValues,
  type FieldOpen,
  type FieldSeal,
  type FieldValue,
  type TenantTx,
} from '@gani/db';
import { uuidv7 } from '@gani/domain';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Put,
} from '@nestjs/common';

import { UuidSchema } from '../../openapi/schemas.js';
import { ZodPipe } from '../../openapi/zod-pipe.js';
import { mayEditCustomers, seesCustomersMasked } from '../customers/customers.permissions.js';
import { DatabaseService } from '../database/database.service.js';
import { currentRequestContext, type RequestContext } from '../request-context/request-context.js';
import { fitFieldValue, valuesView } from './customer-field-values.js';
import { FieldKeysMissingHttpError, fieldValueHttpErrorOf } from './customer-fields.errors.js';
import { CustomerFieldValuesChangeSchema } from './customer-fields.schemas.js';

type Change = { values: { fieldId: string; value: FieldValue | null }[] };

/**
 * A customer's values of the custom fields (J1, N191; Tag 3b-iii, CEO 03/11): every role reads them, Marketing and Viewer with a
 * sensitive value masked (`"••••"`, never decrypted for them); the roles that edit a profile set some of them, audited
 * `customer.fields_changed {fieldIds}` (ids only, never a value). A sensitive value is sealed by SecretBox, bound to its row and
 * column; without a key the API still runs and such a value is 503. A customer or a field of another company is a 404.
 */
@Controller('v1/customers/:id/fields')
export class CustomerFieldValuesController {
  private readonly seal: FieldSeal;
  private readonly open: FieldOpen;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SecretBox) box: SecretBox,
  ) {
    const version = () => {
      try {
        return box.latestVersion;
      } catch {
        throw new FieldKeysMissingHttpError();
      }
    };
    this.seal = (rowId, plaintext) => {
      const keyVersion = version();
      const enc = box.encrypt(plaintext, { rowId, column: FIELD_VALUE_COLUMN }, keyVersion);
      return { enc, keyVersion };
    };
    this.open = (rowId, enc, keyVersion) => {
      try {
        return box.decrypt(enc, { rowId, column: FIELD_VALUE_COLUMN }, keyVersion);
      } catch (error) {
        // No key at all is the 503 of a missing configuration; a key that does not open the value stays an error of its own.
        if (error instanceof SecretDecryptError) version();
        throw error;
      }
    };
  }

  @Get()
  async read(@Param('id', new ZodPipe(UuidSchema)) id: string) {
    const ctx = currentRequestContext();
    const open = seesCustomersMasked(ctx.role) ? undefined : this.open;
    return valuesView(await this.run(ctx, (tx) => present(readFieldValues(tx, id, open))));
  }

  @Put()
  async set(
    @Param('id', new ZodPipe(UuidSchema)) id: string,
    @Body(new ZodPipe(CustomerFieldValuesChangeSchema)) body: Change,
  ) {
    const ctx = currentRequestContext();
    if (!mayEditCustomers(ctx.role)) throw new ForbiddenException();
    const rows = await this.run(ctx, async (tx) => {
      const fieldIds = await present(setFieldValues(tx, id, body.values, this.seal, fitFieldValue));
      await insertAuditLog(tx, {
        id: uuidv7(),
        actorUserId: ctx.userId,
        action: 'customer.fields_changed',
        targetType: 'customer',
        targetId: id,
        detail: { fieldIds: fieldIds.join(',') },
      });
      return present(readFieldValues(tx, id, this.open));
    });
    return valuesView(rows);
  }

  private async run<T>(ctx: RequestContext, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    try {
      return await this.database.withTenant(ctx, fn);
    } catch (error) {
      throw fieldValueHttpErrorOf(error);
    }
  }
}

/** What the store found; 404 when there is no such customer in the company. */
async function present<T>(found: Promise<T | null>): Promise<T> {
  const value = await found;
  if (value === null) throw new NotFoundException();
  return value;
}
