'use client';

import Link from 'next/link';
import { useDeferredValue, useState } from 'react';

import { builtFor, type Role } from '../nav';
import { useApiPages } from '../query/provider';
import { RetryAction } from '../retry-button';
import {
  channelsOf,
  customersPath,
  dayOf,
  MAX_QUERY,
  nameOf,
  phoneText,
  seesMasked,
  type CustomerPage,
} from './customers';

const field = 'rounded-input border border-border-strong px-3 py-2';
const button = 'rounded-input border border-border-strong px-3 py-1 disabled:opacity-70';
const none = <span className="text-text-muted">Chưa có</span>;

/**
 * The customers of the company (#7, `GET /v1/customers`, N165), newest first, by cursor ("Tải thêm"): name, phone, email, the
 * channels that know them, last change. Searched by a part of the name or the start of a phone number (Marketing and Viewer by
 * name only, their phones and emails come masked). Tags, the person in charge and the last contact wait for their API.
 */
export function CustomerList({ role }: { role: Role }) {
  const [q, setQ] = useState('');
  const query = useDeferredValue(q).trim().slice(0, MAX_QUERY);
  const list = useApiPages<CustomerPage>(['customers', query], (cursor) =>
    customersPath(query, cursor),
  );
  const masked = seesMasked(role);
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const home = builtFor(role);
  return (
    <section aria-labelledby="customers-list-title" className="flex flex-col gap-3">
      <h2 id="customers-list-title" className="text-16 font-semibold">
        Danh sách khách
      </h2>
      <label className="flex max-w-[400px] flex-col gap-1">
        Tìm khách
        <input
          type="search"
          value={q}
          maxLength={MAX_QUERY}
          className={field}
          aria-describedby="customers-search-hint"
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      <p id="customers-search-hint" className="text-12 text-text-muted">
        {masked
          ? 'Theo tên. Vai trò của bạn thấy SĐT và email dạng che.'
          : 'Theo tên, hoặc đầu số điện thoại (từ 3 số).'}
      </p>
      {list.isPending ? (
        <p role="status" aria-busy="true" className="text-text-muted">
          Đang tải khách…
        </p>
      ) : list.isError ? (
        <div role="alert" className="flex flex-col gap-2">
          <p>{list.error.error.message}</p>
          {list.error.error.traceId ? (
            <p className="text-12 text-text-muted">Mã: {list.error.error.traceId}</p>
          ) : null}
          <RetryAction onRetry={() => void list.refetch()} busy={list.isFetching} />
        </div>
      ) : rows.length === 0 ? (
        query ? (
          <div className="flex flex-col items-start gap-2">
            <p>Không có khách khớp “{query}”.</p>
            <button type="button" className={button} onClick={() => setQ('')}>
              Xóa tìm kiếm
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <p>Chưa có khách nào. Khách tự có hồ sơ khi nhắn qua kênh đã kết nối.</p>
            <Link href={home.href} className="underline">
              {home.label}
            </Link>
          </div>
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="w-full text-left">
              <thead className="bg-bg-subtle">
                <tr>
                  {['Khách', 'SĐT', 'Email', 'Kênh', 'Cập nhật'].map((t) => (
                    <th key={t} scope="col" className="p-2 font-semibold">
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className="p-2">{nameOf(c)}</td>
                    <td className="p-2 whitespace-nowrap">{c.phone ? phoneText(c.phone) : none}</td>
                    <td className="p-2 break-all">{c.email ?? none}</td>
                    <td className="p-2">{channelsOf(c).join(', ') || none}</td>
                    <td className="p-2">{dayOf(c.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.hasNextPage ? (
            <button
              type="button"
              className={`${button} self-start`}
              disabled={list.isFetchingNextPage}
              aria-busy={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
