-- rollback: compensating migration drops table public.conversations; only acceptable before real conversations exist (N75).
-- conversations: the frame of the table (spec RLS M01 §4.12), the first one with RLS by organisation AND workspace (O+W): a row is seen
-- only when its workspace is in app.current_workspaces(). Session 2 adds columns by expand. state has no DEFAULT on purpose: the
-- ConversationStateMachine of session 2 decides the first state, and until then every insert names it. No UPDATE of a column is
-- blocked yet (N68): the state machine will block what it must.

CREATE TABLE public.conversations (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  state text NOT NULL,
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversations_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  -- A conversation can only sit in a workspace of its own organisation.
  CONSTRAINT conversations_workspace_fk FOREIGN KEY (org_id, workspace_id)
    REFERENCES public.workspaces (org_id, id) ON DELETE RESTRICT,
  -- Target of the composite foreign keys of the child tables of session 2 (messages, events).
  CONSTRAINT conversations_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT conversations_state_check CHECK (
    state IN ('BOT_ACTIVE', 'HUMAN_WAITING_Q', 'HUMAN_ACTIVE', 'PENDING_CUSTOMER', 'CLOSED')
  )
);

CREATE INDEX conversations_org_workspace_state_idx ON public.conversations (org_id, workspace_id, state);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations FORCE ROW LEVEL SECURITY;

-- USING and WITH CHECK both carry the workspace test: without it a person could move a row into a workspace they cannot see.
-- '{}' (no workspace) matches nothing: ANY over an empty array is false. The ::uuid[] cast is required: ANY ((SELECT f())) is
-- read as the subquery form of ANY and fails with 'operator does not exist: uuid = uuid[]'; the cast makes it an array expression
-- and keeps the (SELECT ...) wrapper, so the function runs once per statement, not once per row.
CREATE POLICY conversations_app ON public.conversations FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[]))
  WITH CHECK (org_id = (SELECT app.current_org())::uuid AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[]));

CREATE POLICY conversations_support ON public.conversations FOR SELECT TO support_role
  USING (
    org_id = (SELECT app.current_org())::uuid
    AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[])
    AND (SELECT app.support_access_ok())
  );

-- No DELETE (soft delete and TenantPurgeJob later). The frame has no secret column, so support gets the whole table.
GRANT SELECT, INSERT, UPDATE ON public.conversations TO app_role;
GRANT SELECT ON public.conversations TO support_role;
