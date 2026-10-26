'use client';

import Link from 'next/link';

import type { Role } from '../nav';
import { useApiQuery } from '../query/provider';
import { RetryAction } from '../retry-button';
import {
  channelsOf,
  customerPath,
  dayOf,
  humanOnlyText,
  nameOf,
  phoneText,
  seesMasked,
  VERIFICATION,
  type Customer,
} from './customers';

const TONE = { ok: 'bg-ok-bg text-ok-text', warn: 'bg-warn-bg text-warn-text' };
const back = (
  <Link href="/customers" className="self-start underline">
    Về danh sách khách
  </Link>
);

/**
 * #8 Hồ sơ khách (`GET /v1/customers/{id}`, N165): the profile of one customer of the company and how the channels know them.
 * Marketing and Viewer get the phone and the email masked from the API. Conversations, leads, tickets, tags and notes wait for
 * their API; changing the profile (`PATCH`) comes next.
 */
export function CustomerProfile({ id, role }: { id: string; role: Role }) {
  const customer = useApiQuery<Customer>(['customer', id], customerPath(id));
  if (customer.isPending)
    return (
      <p role="status" aria-busy="true" className="text-text-muted">
        Đang tải hồ sơ khách…
      </p>
    );
  if (customer.isError) {
    const { error } = customer.error;
    // Another company's customer is a 404 like one that does not exist (P9); a malformed id is no better.
    if (error.code === 'not_found' || error.code === 'validation_failed')
      return (
        <div className="flex flex-col items-start gap-2">
          <h1 className="text-20 font-semibold">Không tìm thấy khách</h1>
          <p>Có thể hồ sơ đã bị xóa hoặc thuộc công ty khác.</p>
          {back}
        </div>
      );
    return (
      <div role="alert" className="flex flex-col gap-2">
        <p>{error.message}</p>
        {error.traceId ? <p className="text-12 text-text-muted">Mã: {error.traceId}</p> : null}
        <RetryAction onRetry={() => void customer.refetch()} busy={customer.isFetching} />
      </div>
    );
  }

  const c = customer.data;
  const facts: [string, string][] = [
    ['SĐT', c.phone ? phoneText(c.phone) : 'Chưa có'],
    ['Email', c.email ?? 'Chưa có'],
    ['Kênh', channelsOf(c).join(', ') || 'Chưa có'],
    ['Chỉ người phục vụ', humanOnlyText(c.humanOnly)],
    ['Tạo ngày', dayOf(c.createdAt)],
    ['Cập nhật', dayOf(c.updatedAt)],
  ];
  return (
    <div className="flex flex-col gap-6">
      {back}
      <h1 className="text-20 font-semibold">{nameOf(c)}</h1>
      <section aria-labelledby="customer-info" className="flex flex-col gap-2">
        <h2 id="customer-info" className="text-16 font-semibold">
          Thông tin
        </h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2">
          {facts.map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-text-muted">{term}</dt>
              <dd className="break-all">{value}</dd>
            </div>
          ))}
        </dl>
        {seesMasked(role) ? (
          <p className="text-12 text-text-muted">Vai trò của bạn thấy SĐT và email dạng che.</p>
        ) : null}
      </section>
      <section aria-labelledby="customer-identities" className="flex flex-col gap-2">
        <h2 id="customer-identities" className="text-16 font-semibold">
          Định danh
        </h2>
        {c.identities.length ? (
          <ul className="flex flex-col gap-2">
            {c.identities.map((i, n) => {
              const [tone, label] = VERIFICATION[i.verification];
              return (
                <li key={n} className="flex items-center gap-2">
                  {channelsOf({ identities: [i] })[0]}
                  <span className={`rounded-input px-2 py-1 text-12 ${TONE[tone]}`}>{label}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p>Chưa kênh nào biết khách này.</p>
        )}
      </section>
      <p className="text-12 text-text-muted">
        Hội thoại, lead, ticket, tag và ghi chú của khách: chờ API.
      </p>
    </div>
  );
}
