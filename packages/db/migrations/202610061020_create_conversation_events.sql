-- rollback: compensating migration drops table public.conversation_events and its partitions, then app.conversation_visible(uuid, uuid); only acceptable before real events exist (N94).
-- conversation_events: one row per change of a conversation made by the state machine (FSM spec §7), partitioned by month,
-- append-only for app_role. The table has no workspace_id (Brief P8: O), yet an event must be seen only by whoever sees its
-- conversation (F7): the policies ask app.conversation_visible, which reads conversations as the caller, so the O+W policy of
-- conversations decides. A function and not an EXISTS in the policy text: app.secure_log_partition copies policies onto the
-- partitions as text (pg_get_expr), and an EXISTS would carry the name of the parent table in its subquery.

CREATE FUNCTION app.conversation_visible(p_org uuid, p_conversation uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp
  AS $$
    SELECT EXISTS (SELECT 1 FROM public.conversations c WHERE c.org_id = p_org AND c.id = p_conversation)
  $$;

-- SECURITY INVOKER on purpose: it must run with the RLS of the caller. A DEFINER would run as migration_role (BYPASSRLS) and
-- say "visible" for every conversation.
REVOKE ALL ON FUNCTION app.conversation_visible(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.conversation_visible(uuid, uuid) TO app_role, support_role;

CREATE TABLE public.conversation_events (
  id uuid NOT NULL,
  org_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL,
  from_state text,
  to_state text,
  from_hold boolean,
  to_hold boolean,
  actor_kind text NOT NULL,
  actor_id uuid,
  version_after integer NOT NULL,
  outcome text,
  trace_id text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  CONSTRAINT conversation_events_pkey PRIMARY KEY (id, occurred_at),
  CONSTRAINT conversation_events_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT conversation_events_conversation_fk FOREIGN KEY (org_id, conversation_id)
    REFERENCES public.conversations (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT conversation_events_type_check CHECK (
    event_type IN ('created', 'state_changed', 'claimed', 'transferred', 'reassigned', 'reopened')
  ),
  CONSTRAINT conversation_events_from_state_check CHECK (
    from_state IS NULL OR from_state IN ('BOT_ACTIVE', 'HUMAN_WAITING_Q', 'HUMAN_ACTIVE', 'PENDING_CUSTOMER', 'CLOSED')
  ),
  CONSTRAINT conversation_events_to_state_check CHECK (
    to_state IS NULL OR to_state IN ('BOT_ACTIVE', 'HUMAN_WAITING_Q', 'HUMAN_ACTIVE', 'PENDING_CUSTOMER', 'CLOSED')
  ),
  CONSTRAINT conversation_events_actor_kind_check CHECK (
    actor_kind IN ('customer', 'agent', 'bot', 'system', 'platform_operator')
  ),
  CONSTRAINT conversation_events_trace_id_check CHECK (btrim(trace_id) <> ''),
  CONSTRAINT conversation_events_detail_object CHECK (jsonb_typeof(detail) = 'object')
) PARTITION BY RANGE (occurred_at);

CREATE INDEX conversation_events_conversation_idx ON public.conversation_events (org_id, conversation_id, occurred_at);

ALTER TABLE public.conversation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_events FORCE ROW LEVEL SECURITY;

-- USING and WITH CHECK both carry the visibility test: nobody can write an event for a conversation they cannot see.
CREATE POLICY conversation_events_app ON public.conversation_events FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid AND app.conversation_visible(org_id, conversation_id))
  WITH CHECK (org_id = (SELECT app.current_org())::uuid AND app.conversation_visible(org_id, conversation_id));

CREATE POLICY conversation_events_support ON public.conversation_events FOR SELECT TO support_role
  USING (
    org_id = (SELECT app.current_org())::uuid
    AND app.conversation_visible(org_id, conversation_id)
    AND (SELECT app.support_access_ok())
  );

GRANT SELECT, INSERT ON public.conversation_events TO app_role;
GRANT SELECT ON public.conversation_events TO support_role;

SELECT app.create_log_partitions('public.conversation_events', 2);
