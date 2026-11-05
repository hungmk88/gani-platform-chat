'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { CHANNEL_TYPE } from '../channels/channels';
import { ReadList } from '../customer-data/catalog-screen';
import type { NavItem } from '../nav';
import { Paged } from '../paged-list';
import { PendingPage } from '../pending-page';
import { useApiPages } from '../query/provider';
import { PolicyDialog } from './policy-dialog';
import {
  dayText,
  healthPath,
  MESSAGE_CLASS,
  POLICIES_PATH,
  priceText,
  sourceLink,
  TABS,
  windowText,
  type ChannelPolicy,
  type Tab,
  type TenantHealth,
  type TenantHealthPage,
} from './platform';

const TONE = { warn: 'bg-warn-bg text-warn-text', error: 'bg-error-bg text-error-text' };

/** The links between the tabs of /platform (links, not a tablist, as /me). */
function PlatformNav({ tab }: { tab: Tab }) {
  return (
    <nav aria-label="Phần của Platform" className="flex gap-2 border-b border-border">
      {TABS.map(([k, label]) => (
        <Link
          key={k}
          href={`/platform?tab=${k}`}
          aria-current={tab === k ? 'page' : undefined}
          className={`px-3 py-2 ${tab === k ? 'border-b-2 border-accent font-semibold' : 'text-text-muted'}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** A count of tokens, with its word and coloured as a state when it is not 0. */
function Tokens({ n, tone }: { n: number; tone: keyof typeof TONE }) {
  return n ? <span className={`rounded-input px-2 py-1 ${TONE[tone]}`}>{n}</span> : <>0</>;
}

/** Every company, by cursor: its channels and their Zalo tokens, its AI spend (none until the AI Gateway, U65). A 404: one line. */
function HealthTab() {
  const health = useApiPages<TenantHealthPage>(['platform', 'health'], healthPath);
  return (
    <section aria-labelledby="health-title" className="flex flex-col gap-3">
      <h2 id="health-title" className="text-16 font-semibold">
        Sức khỏe công ty
      </h2>
      {health.isError && health.error.error.code === 'not_found' ? (
        <p>Sức khỏe công ty: chưa có trong bản hiện tại.</p>
      ) : (
        <Paged<TenantHealth>
          query={health}
          loading="Đang tải sức khỏe công ty…"
          empty={<p>Chưa có công ty nào.</p>}
          head={[
            'Công ty',
            'Kênh',
            'Token hết hạn trong 24 giờ',
            'Token đã hết hạn',
            'Chi phí AI tháng',
          ]}
          keyOf={(t) => t.orgId}
          row={(t) => (
            <tr key={t.orgId}>
              <td className="p-2">
                {t.name} <span className="text-12 text-text-muted">{t.slug}</span>
              </td>
              <td className="p-2">{t.channels.total}</td>
              <td className="p-2">
                <Tokens n={t.channels.tokenExpiringSoon} tone="warn" />
              </td>
              <td className="p-2">
                <Tokens n={t.channels.tokenExpired} tone="error" />
              </td>
              <td className="p-2">Chưa tính</td>
            </tr>
          )}
        />
      )}
      <p className="text-12 text-text-muted">Chỉ số vận hành, không có dữ liệu khách.</p>
    </section>
  );
}

/** The channel policies in force, one per channel and class, in the API's order (the read list of #23). */
function PolicyList({ onAdd }: { onAdd: (p: ChannelPolicy) => void }) {
  return (
    <ReadList<ChannelPolicy>
      title="Chính sách kênh"
      path={POLICIES_PATH}
      empty="Chưa có chính sách kênh nào đang hiệu lực."
      head={[
        'Kênh',
        'Loại tin',
        'Khung miễn phí',
        'Ngoài khung',
        'Giá',
        'Hiệu lực từ',
        'Nguồn',
        'Ghi chú',
        'Thao tác',
      ]}
      row={(p) => {
        const link = sourceLink(p.sourceUrl);
        return (
          <tr key={p.id}>
            <td className="p-2">{CHANNEL_TYPE[p.channelType]}</td>
            <td className="p-2">{MESSAGE_CLASS[p.messageClass]}</td>
            <td className="p-2">{windowText(p)}</td>
            <td className="p-2">{p.outsideWindowAllowed ? 'Được gửi' : 'Không được gửi'}</td>
            <td className="p-2">{priceText(p.unitPriceVnd)}</td>
            <td className="p-2">{dayText(p.effectiveFrom)}</td>
            <td className="p-2">
              {link ? (
                <a href={link.href} target="_blank" rel="noopener noreferrer" className="underline">
                  {link.text}
                </a>
              ) : (
                (p.sourceUrl ?? '—')
              )}
              {p.sourceDate ? ` (${dayText(p.sourceDate)})` : null}
            </td>
            <td className="whitespace-pre-line p-2">{p.note || '—'}</td>
            <td className="p-2">
              <button
                type="button"
                className="rounded-input border border-border-strong px-3 py-1"
                aria-label={`Thêm phiên bản cho ${CHANNEL_TYPE[p.channelType]} · ${MESSAGE_CLASS[p.messageClass]}`}
                onClick={() => onAdd(p)}
              >
                Thêm phiên bản…
              </button>
            </td>
          </tr>
        );
      }}
    />
  );
}

/** The policies, and "Thêm phiên bản" of one (PR 30b, tầng 2): once saved, a status sentence takes the focus. */
function PoliciesTab() {
  const [editing, setEditing] = useState<ChannelPolicy | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const said = useRef<HTMLParagraphElement>(null);
  useEffect(() => said.current?.focus(), [notice]);
  return (
    <>
      <PolicyList onAdd={(p) => (setNotice(null), setEditing(p))} />
      {notice ? (
        <p ref={said} role="status" tabIndex={-1}>
          {notice}
        </p>
      ) : null}
      {editing ? (
        <PolicyDialog policy={editing} onClose={() => setEditing(null)} onSaved={setNotice} />
      ) : null}
    </>
  );
}

/**
 * #30 Platform (PR 30a, CEO 05/11, brief 79), the platform operator only: the health of the companies and the channel policies,
 * read only; a 404 of a route is one line in its tab, as the tabs of #23. "Phiên truy cập" is the pending screen until a list of
 * sessions exists (U79); the links to the other tabs stay.
 */
export function PlatformScreen({ tab, item, go }: { tab: Tab; item: NavItem; go: NavItem }) {
  return (
    <section aria-labelledby="platform-title" className="flex max-w-[1080px] flex-col gap-6">
      <h1 id="platform-title" className="text-20 font-semibold">
        Platform
      </h1>
      <PlatformNav tab={tab} />
      {tab === 'health' ? (
        <HealthTab />
      ) : tab === 'policies' ? (
        <PoliciesTab />
      ) : (
        <PendingPage item={{ ...item, label: 'Phiên truy cập' }} go={go} />
      )}
      <p className="text-12 text-text-muted">Không áp dụng AI ở màn này.</p>
    </section>
  );
}
