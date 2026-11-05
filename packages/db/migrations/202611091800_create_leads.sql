-- rollback: compensating migration drops tables public.lead_events and public.leads; only acceptable before any lead is made.
-- leads and lead_events: the leads of a workspace (G1–G3, T-2, T-3, N188, N196, N200; CEO 05/11/2026). RLS by organisation AND
-- workspace, like tickets. A lead is of a customer, sits at a step of its own workspace's pipeline, is open, then won or lost for good
-- (T-3). A lead is never deleted (no DELETE grant). title is the agents' free words and may name the customer: support_role never reads
-- it. lost_reason is one of the workspace's reasons (pipeline_lost_reasons; the store checks it), kept as words so a new list (Q9) leaves
-- it as it was. No score, threshold nor required fields (P22): they wait for Q9 (N200 answer 5).
-- lead_events holds what happened, as codes only: a type, the two steps, the outcome, who and when; never free text (CLAUDE.md rule 5).

CREATE TABLE public.leads (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  title text NOT NULL,
  customer_id uuid NOT NULL,
  conversation_id uuid,
  stage_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open',
  owner_user_id uuid,
  created_by uuid NOT NULL,
  lost_reason text,
  closed_at timestamptz,
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leads_org_workspace_id_key UNIQUE (org_id, workspace_id, id),
  CONSTRAINT leads_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT leads_workspace_fk FOREIGN KEY (org_id, workspace_id)
    REFERENCES public.workspaces (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT leads_customer_fk FOREIGN KEY (org_id, customer_id)
    REFERENCES public.customers (org_id, id) ON DELETE RESTRICT,
  -- With the workspace: a lead never points at a conversation, nor sits at a step, of another workspace (MATCH SIMPLE: a NULL
  -- conversation is not checked).
  CONSTRAINT leads_conversation_fk FOREIGN KEY (org_id, workspace_id, conversation_id)
    REFERENCES public.conversations (org_id, workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT leads_stage_fk FOREIGN KEY (org_id, workspace_id, stage_id)
    REFERENCES public.pipeline_stages (org_id, workspace_id, id) ON DELETE RESTRICT,
  -- A member of the organisation; that it is an active Owner, Admin, Manager or Sales of the workspace is the store's check.
  CONSTRAINT leads_owner_fk FOREIGN KEY (org_id, owner_user_id)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT leads_created_by_fk FOREIGN KEY (org_id, created_by)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT,
  -- 1 to 200 characters, trimmed, in NFC (counted as LeadCreate counts it).
  CONSTRAINT leads_title_check CHECK (
    btrim(title) = title AND title <> '' AND char_length(title) <= 200 AND title = normalize(title, NFC)
  ),
  CONSTRAINT leads_status_check CHECK (status IN ('open', 'won', 'lost')),
  -- Open exactly while it has no closing time; lost exactly when it has a reason.
  CONSTRAINT leads_closed_at_check CHECK ((status = 'open') = (closed_at IS NULL)),
  CONSTRAINT leads_lost_reason_check CHECK (
    (status = 'lost') = (lost_reason IS NOT NULL)
    AND (lost_reason IS NULL OR (btrim(lost_reason) = lost_reason AND lost_reason <> '' AND char_length(lost_reason) <= 200
      AND lost_reason = normalize(lost_reason, NFC)))
  ),
  CONSTRAINT leads_version_check CHECK (version >= 0)
);

-- The list: newest first, by workspace (the cursor of GET /v1/leads); the Kanban by step; the Lead tab of a customer (#8); a Sales'
-- own leads (made or owned, N188).
CREATE INDEX leads_workspace_created_idx ON public.leads (org_id, workspace_id, created_at DESC, id DESC);
CREATE INDEX leads_stage_idx ON public.leads (org_id, workspace_id, stage_id);
CREATE INDEX leads_customer_idx ON public.leads (org_id, customer_id);
CREATE INDEX leads_owner_idx ON public.leads (org_id, owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX leads_created_by_idx ON public.leads (org_id, created_by);

CREATE TABLE public.lead_events (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  type text NOT NULL,
  from_stage_id uuid,
  to_stage_id uuid,
  outcome text,
  actor_user_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_events_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT lead_events_lead_fk FOREIGN KEY (org_id, workspace_id, lead_id)
    REFERENCES public.leads (org_id, workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT lead_events_from_stage_fk FOREIGN KEY (org_id, workspace_id, from_stage_id)
    REFERENCES public.pipeline_stages (org_id, workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT lead_events_to_stage_fk FOREIGN KEY (org_id, workspace_id, to_stage_id)
    REFERENCES public.pipeline_stages (org_id, workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT lead_events_actor_fk FOREIGN KEY (org_id, actor_user_id)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT lead_events_type_check CHECK (type IN ('created', 'stage_changed', 'owner_changed', 'closed')),
  CONSTRAINT lead_events_outcome_check CHECK (outcome IS NULL OR outcome IN ('won', 'lost')),
  -- Made at a step; a change of step has two different ones (the same step is 422 invalid_stage, never an event, N200 answer 4);
  -- closing carries the outcome; a change of owner carries neither.
  CONSTRAINT lead_events_shape_check CHECK (
    CASE type
      WHEN 'created' THEN from_stage_id IS NULL AND to_stage_id IS NOT NULL AND outcome IS NULL
      WHEN 'stage_changed' THEN from_stage_id IS NOT NULL AND to_stage_id IS NOT NULL AND from_stage_id <> to_stage_id
        AND outcome IS NULL
      WHEN 'closed' THEN from_stage_id IS NULL AND to_stage_id IS NULL AND outcome IS NOT NULL
      ELSE from_stage_id IS NULL AND to_stage_id IS NULL AND outcome IS NULL
    END
  )
);

-- The history of a lead, oldest first (GET /v1/leads/{id}).
CREATE INDEX lead_events_lead_idx ON public.lead_events (org_id, lead_id, occurred_at, id);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads FORCE ROW LEVEL SECURITY;
ALTER TABLE public.lead_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_events FORCE ROW LEVEL SECURITY;

-- Same shape as tickets_app (N75): the workspace test in USING and in WITH CHECK.
CREATE POLICY leads_app ON public.leads FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[]))
  WITH CHECK (org_id = (SELECT app.current_org())::uuid AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[]));
CREATE POLICY leads_support ON public.leads FOR SELECT TO support_role
  USING (
    org_id = (SELECT app.current_org())::uuid
    AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[])
    AND (SELECT app.support_access_ok())
  );
CREATE POLICY lead_events_app ON public.lead_events FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[]))
  WITH CHECK (org_id = (SELECT app.current_org())::uuid AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[]));
CREATE POLICY lead_events_support ON public.lead_events FOR SELECT TO support_role
  USING (
    org_id = (SELECT app.current_org())::uuid
    AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[])
    AND (SELECT app.support_access_ok())
  );

-- id, org_id, workspace_id, title, customer_id, conversation_id, created_by and created_at never change in Đợt 1 (no edit of a lead in
-- the contract). No DELETE (case 11). lead_events is append only.
GRANT SELECT, INSERT ON public.leads TO app_role;
GRANT UPDATE (stage_id, status, owner_user_id, lost_reason, closed_at, version, updated_at) ON public.leads TO app_role;
GRANT SELECT (id, org_id, workspace_id, customer_id, conversation_id, stage_id, status, owner_user_id, created_by, lost_reason,
  closed_at, version, created_at, updated_at) ON public.leads TO support_role;
GRANT SELECT, INSERT ON public.lead_events TO app_role;
GRANT SELECT ON public.lead_events TO support_role;
