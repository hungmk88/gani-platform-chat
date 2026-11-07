'use client';

import { FIELDS_PATH, type CustomerField } from '../customer-data/catalog';
import { readListKey } from '../customer-data/catalog-screen';
import { useApiQuery } from '../query/provider';
import { RetryAction } from '../retry-button';
import { fieldRows, fieldsPath, valueText, type FieldValues } from './customer-fields';

/**
 * "Thông tin thêm" of #8 (J1, N191; CEO brief 169 P2b-1): the company's fields (`GET /v1/customer-fields`, the cache of #23) with
 * this customer's values (`GET …/fields`), by position; a hidden field only when it has a value. Every role reads it; changing the
 * values is P2b-2.
 */
export function CustomerFieldsSection({ id }: { id: string }) {
  const fields = useApiQuery<{ readonly data: readonly CustomerField[] }>(
    readListKey(FIELDS_PATH),
    FIELDS_PATH,
  );
  const values = useApiQuery<FieldValues>(['customer', id, 'fields'], fieldsPath(id));
  const failed = fields.isError ? fields : values.isError ? values : null;
  return (
    <section aria-labelledby="customer-fields" className="flex flex-col gap-2">
      <h2 id="customer-fields" className="text-16 font-semibold">
        Thông tin thêm
      </h2>
      {failed ? (
        <div role="alert" className="flex flex-col gap-2">
          <p>{failed.error.error.message}</p>
          {failed.error.error.traceId ? (
            <p className="text-12 text-text-muted">Mã: {failed.error.error.traceId}</p>
          ) : null}
          <RetryAction onRetry={() => void failed.refetch()} busy={failed.isFetching} />
        </div>
      ) : !fields.isSuccess || !values.isSuccess ? (
        <p role="status" aria-busy="true" className="text-text-muted">
          Đang tải thông tin thêm…
        </p>
      ) : fields.data.data.length === 0 ? (
        <p>Công ty chưa có trường tùy chỉnh. Owner hoặc Admin thêm ở Cài đặt › Dữ liệu khách.</p>
      ) : (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2">
          {fieldRows(fields.data.data, values.data.data).map(({ field, value }) => (
            <div key={field.id} className="contents">
              <dt className="text-text-muted">
                {field.name}
                {field.hidden ? ' (đã ẩn)' : null}
              </dt>
              <dd className="whitespace-pre-wrap break-words">{valueText(field, value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
