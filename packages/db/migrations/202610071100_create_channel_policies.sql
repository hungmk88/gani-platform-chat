-- rollback: compensating migration drops table public.channel_policies; only acceptable before the code reads it (no other table points at it).
-- channel_policies: the rules of a channel for sending messages (window, free quota, price), one row per channel, class of message and
-- start date (channel-policy-spec §1, Brief P8). Global table, no org_id and no RLS, access is controlled by GRANT alone (as feature_flags_global).
-- The rules are data, not code: when the platform changes its policy, a migration adds a row with a new effective_from. A row is never
-- edited, so the history explains why an old message could or could not be sent.

CREATE TABLE public.channel_policies (
  id uuid PRIMARY KEY,
  channel_type text NOT NULL,
  message_class text NOT NULL,
  effective_from timestamptz NOT NULL,
  -- Free window counted from the last interaction of the user. NULL: the class has no window.
  free_window_seconds integer,
  -- Free messages inside the window. NULL: no quota.
  free_message_quota integer,
  unit_price_vnd integer,
  -- No default on purpose: whoever writes the row has to say whether a message outside the window can be sent (and paid).
  outside_window_allowed boolean NOT NULL,
  source_url text,
  source_date date,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT channel_policies_channel_type_check CHECK (channel_type IN ('zalo_oa', 'facebook', 'webchat')),
  CONSTRAINT channel_policies_message_class_check CHECK (message_class IN ('advisory', 'transaction', 'broadcast')),
  CONSTRAINT channel_policies_free_window_seconds_check CHECK (free_window_seconds IS NULL OR free_window_seconds >= 0),
  CONSTRAINT channel_policies_free_message_quota_check CHECK (free_message_quota IS NULL OR free_message_quota >= 0),
  CONSTRAINT channel_policies_unit_price_vnd_check CHECK (unit_price_vnd IS NULL OR unit_price_vnd >= 0),
  CONSTRAINT channel_policies_source_url_check CHECK (source_url IS NULL OR btrim(source_url) <> ''),
  CONSTRAINT channel_policies_note_check CHECK (btrim(note) <> ''),
  -- One policy per channel, class and start date.
  CONSTRAINT channel_policies_channel_class_effective_key UNIQUE (channel_type, message_class, effective_from)
);

-- Brief P8. The unique key above already starts with channel_type; this one is kept as the Brief says (the table has a handful of rows).
CREATE INDEX channel_policies_channel_type_effective_from_idx ON public.channel_policies (channel_type, effective_from);

-- Read only for the application and for support: no tenant data here, so support needs no access-session.
-- Policies are created by migration_role only.
GRANT SELECT ON public.channel_policies TO app_role, support_role;
