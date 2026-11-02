-- rollback: compensating migration drops tables public.ticket_events and public.tickets; only acceptable before any ticket is made.
-- tickets and ticket_events: the tickets of a workspace (U27, N167, N170; Brief P8 M06 "tickets, ticket_events: O+W"). RLS by organisation
-- AND workspace, like conversations: a Support of workspace A never sees B's. Five states (U27), three priorities (C8). type and the SLA
-- columns stay NULL until Q8 (the kinds of The Smile) and Q7 (business hours): app_role cannot write them yet. A ticket is never
-- deleted (no DELETE grant). title and description are the agents' free words and may name the customer: support_role never reads them.
-- ticket_events holds what happened, as codes only: a type, the two states, who and when; never free text (CLAUDE.md rule 5).

CREATE TABLE public.tickets (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'new',
  priority text NOT NULL DEFAULT 'normal',
  type text,
  customer_id uuid,
  conversation_id uuid,
  assignee_user_id uuid,
  created_by uuid NOT NULL,
  sla_due_at timestamptz,
  sla_paused_reason text,
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tickets_org_workspace_id_key UNIQUE (org_id, workspace_id, id),
  CONSTRAINT tickets_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT tickets_workspace_fk FOREIGN KEY (org_id, workspace_id)
    REFERENCES public.workspaces (org_id, id) ON DELETE RESTRICT,
  -- Pairs with org_id (and the workspace for a conversation): a ticket never points into another organisation or workspace.
  -- Default MATCH SIMPLE: not checked when the referencing column is NULL.
  CONSTRAINT tickets_customer_fk FOREIGN KEY (org_id, customer_id)
    REFERENCES public.customers (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT tickets_conversation_fk FOREIGN KEY (org_id, workspace_id, conversation_id)
    REFERENCES public.conversations (org_id, workspace_id, id) ON DELETE RESTRICT,
  -- A member of the organisation; that it is an Owner, Admin, Manager or Support of the workspace (U52, N170) is the store's check.
  CONSTRAINT tickets_assignee_fk FOREIGN KEY (org_id, assignee_user_id)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT tickets_created_by_fk FOREIGN KEY (org_id, created_by)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT tickets_title_check CHECK (btrim(title) <> '' AND char_length(title) <= 200),
  CONSTRAINT tickets_description_check CHECK (description IS NULL OR char_length(description) <= 5000),
  CONSTRAINT tickets_status_check CHECK (status IN ('new', 'in_progress', 'waiting_customer', 'done', 'cancelled')),
  CONSTRAINT tickets_priority_check CHECK (priority IN ('normal', 'high', 'urgent')),
  CONSTRAINT tickets_type_check CHECK (type IS NULL OR type ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT tickets_sla_paused_reason_check CHECK (sla_paused_reason IS NULL OR sla_paused_reason IN ('waiting_customer', 'outside_hours')),
  CONSTRAINT tickets_version_check CHECK (version >= 0)
);

-- The list: newest first, by workspace (the cursor of GET /v1/tickets).
CREATE INDEX tickets_workspace_created_idx ON public.tickets (org_id, workspace_id, created_at DESC, id DESC);
-- Brief P8 M06: by state and due time, for the SLA sweep once Q7 is settled.
CREATE INDEX tickets_workspace_status_due_idx ON public.tickets (org_id, workspace_id, status, sla_due_at);
-- The tickets of one conversation (U53).
CREATE INDEX tickets_conversation_idx ON public.tickets (org_id, conversation_id) WHERE conversation_id IS NOT NULL;

CREATE TABLE public.ticket_events (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  ticket_id uuid NOT NULL,
  type text NOT NULL,
  from_status text,
  to_status text,
  actor_user_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_events_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT ticket_events_ticket_fk FOREIGN KEY (org_id, workspace_id, ticket_id)
    REFERENCES public.tickets (org_id, workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT ticket_events_actor_fk FOREIGN KEY (org_id, actor_user_id)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT ticket_events_type_check CHECK (type IN ('created', 'status_changed', 'assigned', 'edited')),
  CONSTRAINT ticket_events_status_check CHECK (
    (from_status IS NULL OR from_status IN ('new', 'in_progress', 'waiting_customer', 'done', 'cancelled'))
    AND (to_status IS NULL OR to_status IN ('new', 'in_progress', 'waiting_customer', 'done', 'cancelled'))
  ),
  -- Only a change of state carries states: made is to `new`; a change has two different ones; the others none.
  CONSTRAINT ticket_events_shape_check CHECK (
    CASE type
      WHEN 'created' THEN from_status IS NULL AND to_status = 'new'
      WHEN 'status_changed' THEN from_status IS NOT NULL AND to_status IS NOT NULL AND from_status <> to_status
      ELSE from_status IS NULL AND to_status IS NULL
    END
  )
);

-- The history of a ticket, oldest first (GET /v1/tickets/{id}).
CREATE INDEX ticket_events_ticket_idx ON public.ticket_events (org_id, ticket_id, occurred_at, id);

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_events FORCE ROW LEVEL SECURITY;

-- Same shape as quick_replies_app (N75): the workspace test in USING and in WITH CHECK.
CREATE POLICY tickets_app ON public.tickets FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[]))
  WITH CHECK (org_id = (SELECT app.current_org())::uuid AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[]));
CREATE POLICY tickets_support ON public.tickets FOR SELECT TO support_role
  USING (
    org_id = (SELECT app.current_org())::uuid
    AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[])
    AND (SELECT app.support_access_ok())
  );
CREATE POLICY ticket_events_app ON public.ticket_events FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[]))
  WITH CHECK (org_id = (SELECT app.current_org())::uuid AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[]));
CREATE POLICY ticket_events_support ON public.ticket_events FOR SELECT TO support_role
  USING (
    org_id = (SELECT app.current_org())::uuid
    AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[])
    AND (SELECT app.support_access_ok())
  );

-- id, org_id, workspace_id, created_by, created_at, customer_id and conversation_id never change; type and the SLA columns wait for
-- Q8 and Q7 (a later migration grants them). No DELETE. ticket_events is append only.
GRANT SELECT, INSERT ON public.tickets TO app_role;
GRANT UPDATE (title, description, status, priority, assignee_user_id, version, updated_at) ON public.tickets TO app_role;
GRANT SELECT (id, org_id, workspace_id, status, priority, type, customer_id, conversation_id, assignee_user_id, created_by,
  sla_due_at, sla_paused_reason, version, created_at, updated_at) ON public.tickets TO support_role;
GRANT SELECT, INSERT ON public.ticket_events TO app_role;
GRANT SELECT ON public.ticket_events TO support_role;
