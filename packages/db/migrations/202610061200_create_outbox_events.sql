-- rollback: compensating migration drops table public.outbox_events and its partitions; only acceptable before real events wait in it (N97).
-- outbox_events: the business events of a transaction, written in that transaction and sent to the queue later by the relay
-- (outbox spec §2, Phụ lục v2.3 §21), partitioned by month, RLS by organisation (Brief P8: O). The row is a fact that never changes:
-- app_role may INSERT it and may UPDATE only the columns that follow the relay (status, attempts, available_at, claimed_at,
-- published_at, last_error), never payload, type, aggregate or actor. last_error holds a code, not a message, so it cannot carry PII.
-- workspace_id is null for an event of the organisation as a whole.

CREATE TABLE public.outbox_events (
  id uuid NOT NULL,
  org_id uuid NOT NULL,
  workspace_id uuid,
  event_type text NOT NULL,
  event_version integer NOT NULL DEFAULT 1,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_version integer,
  payload jsonb NOT NULL DEFAULT '{}',
  actor_kind text NOT NULL,
  actor_id uuid,
  trace_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  published_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbox_events_pkey PRIMARY KEY (id, created_at),
  CONSTRAINT outbox_events_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  -- MATCH SIMPLE: with a null workspace_id this is not tested, as wanted.
  CONSTRAINT outbox_events_workspace_fk FOREIGN KEY (org_id, workspace_id)
    REFERENCES public.workspaces (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT outbox_events_type_check CHECK (btrim(event_type) <> '' AND btrim(aggregate_type) <> '' AND btrim(trace_id) <> ''),
  CONSTRAINT outbox_events_version_check CHECK (event_version >= 1 AND (aggregate_version IS NULL OR aggregate_version >= 0)),
  CONSTRAINT outbox_events_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT outbox_events_actor_kind_check CHECK (actor_kind IN ('customer', 'agent', 'bot', 'system', 'platform_operator')),
  CONSTRAINT outbox_events_status_check CHECK (status IN ('pending', 'claimed', 'published', 'dead_letter')),
  CONSTRAINT outbox_events_attempts_check CHECK (attempts >= 0),
  -- Exactly the published rows have a published_at; a row held by a relay has the time it was taken.
  CONSTRAINT outbox_events_published_check CHECK ((status = 'published') = (published_at IS NOT NULL)),
  CONSTRAINT outbox_events_claimed_check CHECK (status <> 'claimed' OR claimed_at IS NOT NULL),
  CONSTRAINT outbox_events_last_error_check CHECK (last_error IS NULL OR (btrim(last_error) <> '' AND char_length(last_error) <= 64))
) PARTITION BY RANGE (created_at);

-- Brief P8 index, and the two the relay reads: what is due (also what the org list of the relay scans) and what a dead relay left
-- claimed. Partial, so the published rows that make up most of the table are not in them.
CREATE INDEX outbox_events_status_created_idx ON public.outbox_events (status, created_at);
CREATE INDEX outbox_events_due_idx ON public.outbox_events (org_id, available_at) WHERE status = 'pending';
CREATE INDEX outbox_events_claimed_idx ON public.outbox_events (org_id, claimed_at) WHERE status = 'claimed';

ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_events FORCE ROW LEVEL SECURITY;

CREATE POLICY outbox_events_app ON public.outbox_events FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);

CREATE POLICY outbox_events_support ON public.outbox_events FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));

-- No DELETE: published rows leave with their partition (PartitionMaintenanceJob, 30 days, O5).
GRANT SELECT, INSERT ON public.outbox_events TO app_role;
GRANT UPDATE (status, attempts, available_at, claimed_at, published_at, last_error) ON public.outbox_events TO app_role;
GRANT SELECT ON public.outbox_events TO support_role;

SELECT app.create_log_partitions('public.outbox_events', 2);
