-- rollback: compensating migration drops table public.inbound_events and its partitions; only acceptable before real inbound events wait in it (N104).
-- inbound_events: what a channel sent us, written by the webhook before it answers 200 and processed later by the worker that polls
-- this table (inbound spec §1-§3, N100: polling, not a queue), partitioned by month, RLS by organisation (Brief P8: O). A row is a fact
-- that never changes: app_role may INSERT it and may UPDATE only the columns that follow the worker (status, attempts, available_at,
-- claimed_at, processed_at, last_error), never payload, platform_message_id or the channel.
-- Duplicates are NOT stopped here: PostgreSQL cannot keep a unique key on a partitioned table that does not contain the partition
-- column, so a webhook sent again across a month boundary would pass. The table inbound_event_keys (the next PR, 2a-2) holds that key (I1).
-- payload is jsonb: it does not keep the original bytes (key order, white space). The signature is checked on the raw body before the row
-- is written; if a reprocess ever needs the exact bytes, a nullable bytea column is added by an expand migration.
-- last_error holds a CODE of at most 64 characters, never a message, so it cannot carry PII: the code of the last failure, or for an
-- `ignored` event the code of the reason it was ignored. payload holds the content of customers: it is never logged and support_role
-- cannot read it (the table is O, not O+W, so it holds the content of every workspace of the organisation).

CREATE TABLE public.inbound_events (
  id uuid NOT NULL,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  channel_account_id uuid NOT NULL,
  -- The id the platform gives the event, or `raw:` + sha256 of the raw body when it gives none (I5).
  platform_message_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  processed_at timestamptz,
  last_error text,
  CONSTRAINT inbound_events_pkey PRIMARY KEY (id, received_at),
  CONSTRAINT inbound_events_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  -- The channel account must be of this organisation AND of this workspace.
  CONSTRAINT inbound_events_channel_account_fk FOREIGN KEY (org_id, workspace_id, channel_account_id)
    REFERENCES public.channel_accounts (org_id, workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT inbound_events_text_check CHECK (btrim(platform_message_id) <> '' AND btrim(event_type) <> ''),
  CONSTRAINT inbound_events_status_check CHECK (status IN ('pending', 'claimed', 'processed', 'ignored', 'dead_letter')),
  CONSTRAINT inbound_events_attempts_check CHECK (attempts >= 0),
  -- Exactly the finished rows have a processed_at; a row held by a worker has the time it was taken.
  CONSTRAINT inbound_events_processed_check CHECK ((status IN ('processed', 'ignored')) = (processed_at IS NOT NULL)),
  CONSTRAINT inbound_events_claimed_check CHECK (status <> 'claimed' OR claimed_at IS NOT NULL),
  -- An ignored event says why.
  CONSTRAINT inbound_events_ignored_check CHECK (status <> 'ignored' OR last_error IS NOT NULL),
  CONSTRAINT inbound_events_last_error_check CHECK (last_error IS NULL OR (btrim(last_error) <> '' AND char_length(last_error) <= 64))
) PARTITION BY RANGE (received_at);

-- Brief P8 index, the one of the channel, and the two the worker reads (what is due, and what a dead worker left claimed). The last two
-- are partial, so the finished rows that make up most of the table are not in them.
CREATE INDEX inbound_events_status_received_idx ON public.inbound_events (status, received_at);
CREATE INDEX inbound_events_channel_received_idx ON public.inbound_events (channel_account_id, received_at);
CREATE INDEX inbound_events_due_idx ON public.inbound_events (org_id, available_at) WHERE status = 'pending';
CREATE INDEX inbound_events_claimed_idx ON public.inbound_events (org_id, claimed_at) WHERE status = 'claimed';

ALTER TABLE public.inbound_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_events FORCE ROW LEVEL SECURITY;

CREATE POLICY inbound_events_app ON public.inbound_events FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);

CREATE POLICY inbound_events_support ON public.inbound_events FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));

-- No DELETE: finished rows leave with their partition (PartitionMaintenanceJob, 30 days, not in this PR).
GRANT SELECT, INSERT ON public.inbound_events TO app_role;
GRANT UPDATE (status, attempts, available_at, claimed_at, processed_at, last_error) ON public.inbound_events TO app_role;
-- support_role reads the metadata only. The list names every allowed column, so a column added later stays hidden until a migration
-- shows it, and payload is never in it (as the secrets of channel_accounts and key_hash of api_keys).
GRANT SELECT (id, org_id, workspace_id, channel_account_id, platform_message_id, event_type, received_at, status, attempts,
  available_at, claimed_at, processed_at, last_error) ON public.inbound_events TO support_role;

SELECT app.create_log_partitions('public.inbound_events', 2);
