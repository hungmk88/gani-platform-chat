-- rollback: compensating migration drops table public.quick_replies; only acceptable before workspaces have templates of their own (N163).
-- quick_replies: the canned answers of a workspace that an agent picks by typing "/" in the Inbox (C7, spec-M8 §3.2, endpoint-M8 §2,
-- N163). Shared by everyone of the workspace, so RLS by organisation AND workspace, like conversations: a Sales of workspace A never
-- sees B's. The body may hold the variables of Đợt 1 ({{customer_name}}, {{agent_name}}, {{company_name}}, {{company_phone}}), which
-- the Inbox fills; which variables are allowed is the API's check. A template ends with deleted_at, never a DELETE; its shortcut is then
-- free again. Tags are free words for finding templates (N163), not the tags of customers (J4).

CREATE TABLE public.quick_replies (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  shortcut text NOT NULL,
  body text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  use_count integer NOT NULL DEFAULT 0,
  created_by uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quick_replies_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT quick_replies_workspace_fk FOREIGN KEY (org_id, workspace_id)
    REFERENCES public.workspaces (org_id, id) ON DELETE RESTRICT,
  -- Default MATCH SIMPLE: not checked when created_by IS NULL.
  CONSTRAINT quick_replies_created_by_fk FOREIGN KEY (org_id, created_by)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT,
  -- What is typed after "/": lower case, no space, so the Inbox can match it as the agent types.
  CONSTRAINT quick_replies_shortcut_check CHECK (shortcut ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
  CONSTRAINT quick_replies_body_check CHECK (btrim(body) <> '' AND char_length(body) <= 2000),
  CONSTRAINT quick_replies_tags_check CHECK (cardinality(tags) <= 10),
  CONSTRAINT quick_replies_use_count_check CHECK (use_count >= 0)
);

-- One live template per shortcut in a workspace; a deleted one gives its shortcut back.
CREATE UNIQUE INDEX quick_replies_shortcut_key ON public.quick_replies (org_id, workspace_id, shortcut)
  WHERE deleted_at IS NULL;
-- The list of the Inbox: most used first.
CREATE INDEX quick_replies_workspace_use_idx ON public.quick_replies (org_id, workspace_id, use_count DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.quick_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quick_replies FORCE ROW LEVEL SECURITY;

-- Same shape as messages_app (N75): the workspace test in USING and in WITH CHECK.
CREATE POLICY quick_replies_app ON public.quick_replies FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[]))
  WITH CHECK (org_id = (SELECT app.current_org())::uuid AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[]));

CREATE POLICY quick_replies_support ON public.quick_replies FOR SELECT TO support_role
  USING (
    org_id = (SELECT app.current_org())::uuid
    AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[])
    AND (SELECT app.support_access_ok())
  );

-- id, org_id, workspace_id and created_by never change. No DELETE.
GRANT SELECT, INSERT ON public.quick_replies TO app_role;
GRANT UPDATE (shortcut, body, tags, use_count, deleted_at, updated_at) ON public.quick_replies TO app_role;
GRANT SELECT ON public.quick_replies TO support_role;
