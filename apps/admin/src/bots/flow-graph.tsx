'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { useApiQuery } from '../query/provider';
import { flowsPath, type BotFlowDetail, type BotFlowList } from './bot-flows';
import { configLines, NODE_TYPE, stepsOf, type BotNode } from './graph';

const tab = 'rounded-input border border-border-strong px-3 py-1';

/**
 * #17 part B (CEO 01/11): the steps of the version published last, or of the draft (`?ban=nhap`; the draft when nothing is
 * published), as an ordered list, read only. Each step is focusable; its lines lead to the next steps on the page.
 */
export function FlowGraph({ flow }: { flow: BotFlowDetail }) {
  const ban = useSearchParams().get('ban');
  const draft = !flow.published || ban === 'nhap';
  const version = draft ? flow.draft : flow.published!;
  // A jump links a flow of the workspace only when the list has it: never a link that 404s.
  const flows = useApiQuery<BotFlowList>(
    ['bot-flows', flow.workspaceId],
    flowsPath(flow.workspaceId),
  );
  const steps = stepsOf(version.graph);
  const numberOf = new Map(steps.map((s) => [s.node.key, s.n]));
  const target = (node: BotNode) => {
    if (node.type !== 'jump_to_flow') return null;
    const id = node.config.flowId;
    const found = flows.data?.data.find((f) => f.id === id);
    return found ? (
      <Link href={`/bots/${encodeURIComponent(id)}`} className="underline">
        {found.name}
      </Link>
    ) : (
      <abbr title={id}>…{id.slice(-8)}</abbr>
    );
  };
  return (
    <section aria-labelledby="steps-title" className="flex flex-col gap-3">
      <h2 id="steps-title" className="text-16 font-semibold">
        Các bước
      </h2>
      <nav aria-label="Chọn bản" className="flex gap-2">
        {flow.published ? (
          <Link href="?ban=xuat-ban" aria-current={draft ? undefined : 'page'} className={tab}>
            Bản đã xuất bản
          </Link>
        ) : null}
        <Link href="?ban=nhap" aria-current={draft ? 'page' : undefined} className={tab}>
          Bản nháp
        </Link>
      </nav>
      {steps.length === 0 ? <p>Bản này chưa có bước nào.</p> : null}
      <ol className="flex flex-col gap-2" hidden={steps.length === 0}>
        {steps.map(({ node, n, reached, next }) => (
          <li key={node.key}>
            <article
              id={`buoc-${node.key}`}
              tabIndex={0}
              aria-labelledby={`buoc-${node.key}-ten`}
              className="flex flex-col gap-1 rounded-card border border-border p-3"
            >
              <h3 id={`buoc-${node.key}-ten`} className="font-semibold">
                Bước {n}: {NODE_TYPE[node.type]} <code className="font-normal">{node.key}</code>
              </h3>
              {reached ? null : <p className="text-error-text">Không có đường tới bước này.</p>}
              <dl className="grid gap-x-4 sm:grid-cols-[max-content_1fr]">
                {configLines(node).map(([term, text, code]) => (
                  <div key={term} className="contents">
                    <dt className="text-text-muted">{term}</dt>
                    <dd className="whitespace-pre-wrap">{code ? <code>{text}</code> : text}</dd>
                  </div>
                ))}
                {node.type === 'jump_to_flow' ? (
                  <div className="contents">
                    <dt className="text-text-muted">Sang flow</dt>
                    <dd>{target(node)}</dd>
                  </div>
                ) : null}
              </dl>
              {next.length ? (
                <p className="flex flex-wrap gap-x-3">
                  Tiếp theo:
                  {next.map((e) => (
                    <a
                      key={`${e.to}-${e.label ?? ''}`}
                      href={`#buoc-${e.to}`}
                      className="underline"
                    >
                      Bước {numberOf.get(e.to) ?? e.to}
                      {e.label ? ` (${e.label})` : ''}
                    </a>
                  ))}
                </p>
              ) : null}
            </article>
          </li>
        ))}
      </ol>
    </section>
  );
}
