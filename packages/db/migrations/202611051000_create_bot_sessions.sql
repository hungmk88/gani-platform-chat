-- rollback: compensating migration drops table public.bot_session_steps and its partitions, then public.bot_sessions; only acceptable
-- before any bot runs (D1b1a, N183).
-- bot_sessions: the run of a published flow version in one conversation (Brief P13 "runtime là máy trạng thái chạy trên bot_sessions",
-- M05: unique (org_id, conversation_id) while active). The session keeps its version until it ends (P13: a running conversation keeps
-- the old version); jump_to_flow moves it to another flow's version. `vars` may hold what the customer gave (a phone, an address): the
-- policies ask app.conversation_visible like conversation_events, so only who sees the conversation sees its session (A, 01/11/2026),
-- not every person of the organisation. Nothing is deleted: a session ends with a status and ended_at.
-- bot_session_steps: one row per step, partitioned by month, append-only (Brief :401: bot_sessions keeps the last 20 steps). The
-- payload never holds free text or a variable's value (A, 01/11/2026; CLAUDE.md rule 5): only the label of the edge taken and the name
-- of a variable, which the CHECK enforces.

CREATE TABLE public.bot_sessions (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  version_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active',
  -- The node the run stands on; null before the first step.
  current_node_key text,
  -- What the session waits for from the customer (a question's kind, its variable); null when not waiting.
  awaiting jsonb,
  vars jsonb NOT NULL DEFAULT '{}',
  -- The last 20 steps, for a quick look; the full log is bot_session_steps.
  recent_steps jsonb NOT NULL DEFAULT '[]',
  step_count integer NOT NULL DEFAULT 0,
  -- Optimistic lock of the session.
  version integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CONSTRAINT bot_sessions_org_id_key UNIQUE (org_id, id),
  -- The target of the steps' foreign key: a step names its session and that session's conversation.
  CONSTRAINT bot_sessions_conversation_key UNIQUE (org_id, id, conversation_id),
  CONSTRAINT bot_sessions_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT bot_sessions_conversation_fk FOREIGN KEY (org_id, conversation_id)
    REFERENCES public.conversations (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT bot_sessions_version_fk FOREIGN KEY (org_id, version_id)
    REFERENCES public.bot_flow_versions (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT bot_sessions_status_check CHECK (status IN ('active', 'completed', 'handed_off', 'abandoned')),
  CONSTRAINT bot_sessions_ended_check CHECK ((status = 'active') = (ended_at IS NULL)),
  CONSTRAINT bot_sessions_node_check CHECK (current_node_key IS NULL OR current_node_key ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT bot_sessions_awaiting_check CHECK (awaiting IS NULL OR jsonb_typeof(awaiting) = 'object'),
  CONSTRAINT bot_sessions_vars_check CHECK (jsonb_typeof(vars) = 'object'),
  CONSTRAINT bot_sessions_recent_check
    CHECK (jsonb_typeof(recent_steps) = 'array' AND jsonb_array_length(recent_steps) <= 20),
  CONSTRAINT bot_sessions_counts_check CHECK (step_count >= 0 AND version >= 0)
);

-- M05: one active session per conversation.
CREATE UNIQUE INDEX bot_sessions_active_key ON public.bot_sessions (org_id, conversation_id) WHERE status = 'active';

CREATE TABLE public.bot_session_steps (
  id uuid NOT NULL,
  org_id uuid NOT NULL,
  session_id uuid NOT NULL,
  -- The session's conversation, for the visibility policy; the foreign key makes it the session's own.
  conversation_id uuid NOT NULL,
  step_index integer NOT NULL,
  node_key text NOT NULL,
  node_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bot_session_steps_pkey PRIMARY KEY (id, occurred_at),
  CONSTRAINT bot_session_steps_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT bot_session_steps_session_fk FOREIGN KEY (org_id, session_id, conversation_id)
    REFERENCES public.bot_sessions (org_id, id, conversation_id) ON DELETE RESTRICT,
  CONSTRAINT bot_session_steps_index_check CHECK (step_index >= 0),
  CONSTRAINT bot_session_steps_node_check CHECK (node_key ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT bot_session_steps_type_check CHECK (node_type IN ('trigger', 'message', 'question', 'condition', 'set_variable',
    'collect', 'tag', 'api_call', 'delay', 'handoff', 'jump_to_flow', 'end')),
  -- Only the edge's label and a variable's name, each a short string: no free text, no value (rule 5).
  CONSTRAINT bot_session_steps_payload_check CHECK (
    jsonb_typeof(payload) = 'object'
    AND (payload - ARRAY['edge_label', 'variable']) = '{}'::jsonb
    AND (NOT payload ? 'edge_label' OR (jsonb_typeof(payload -> 'edge_label') = 'string'
      AND char_length(payload ->> 'edge_label') <= 100))
    AND (NOT payload ? 'variable' OR (payload ->> 'variable') ~ '^[a-z][a-z0-9_]{0,63}$')
  )
) PARTITION BY RANGE (occurred_at);

CREATE INDEX bot_session_steps_session_idx ON public.bot_session_steps (org_id, session_id, step_index);

ALTER TABLE public.bot_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.bot_session_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_session_steps FORCE ROW LEVEL SECURITY;

-- USING and WITH CHECK both carry the visibility test: nobody reads or writes the session of a conversation they cannot see.
CREATE POLICY bot_sessions_app ON public.bot_sessions FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid AND app.conversation_visible(org_id, conversation_id))
  WITH CHECK (org_id = (SELECT app.current_org())::uuid AND app.conversation_visible(org_id, conversation_id));
CREATE POLICY bot_sessions_support ON public.bot_sessions FOR SELECT TO support_role
  USING (
    org_id = (SELECT app.current_org())::uuid
    AND app.conversation_visible(org_id, conversation_id)
    AND (SELECT app.support_access_ok())
  );
CREATE POLICY bot_session_steps_app ON public.bot_session_steps FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid AND app.conversation_visible(org_id, conversation_id))
  WITH CHECK (org_id = (SELECT app.current_org())::uuid AND app.conversation_visible(org_id, conversation_id));
CREATE POLICY bot_session_steps_support ON public.bot_session_steps FOR SELECT TO support_role
  USING (
    org_id = (SELECT app.current_org())::uuid
    AND app.conversation_visible(org_id, conversation_id)
    AND (SELECT app.support_access_ok())
  );

-- id, org_id, conversation_id and started_at never change; version_id does (jump_to_flow). No DELETE anywhere; steps are append-only.
GRANT SELECT, INSERT ON public.bot_sessions TO app_role;
GRANT UPDATE (version_id, status, current_node_key, awaiting, vars, recent_steps, step_count, version, updated_at, ended_at)
  ON public.bot_sessions TO app_role;
GRANT SELECT ON public.bot_sessions TO support_role;
GRANT SELECT, INSERT ON public.bot_session_steps TO app_role;
GRANT SELECT ON public.bot_session_steps TO support_role;

SELECT app.create_log_partitions('public.bot_session_steps', 2);
