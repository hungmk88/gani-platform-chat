import { assigneeOf, type Ticket } from './tickets';

/** Who handles the ticket (`assigneeOf`): nobody muted, a person without a name by the end of the id with its reason on hover. */
export function Assignee({ t }: { t: Pick<Ticket, 'assignee'> }) {
  const a = assigneeOf(t);
  if (a.none) return <span className="text-text-muted">{a.text}</span>;
  return a.title ? <abbr title={a.title}>{a.text}</abbr> : <>{a.text}</>;
}
