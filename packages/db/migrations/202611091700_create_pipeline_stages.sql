-- rollback: compensating migration drops tables public.pipeline_lost_reasons and public.pipeline_stages; only before any lead exists.
-- The pipeline of a workspace (G1–G3, N196, N200; CEO 05/11/2026): its steps in order and its reasons to lose a lead, the data of
-- GET /v1/workspaces/{id}/pipeline. RLS by organisation AND workspace, like tickets. Both are configuration a platform operator writes
-- through the deploy pipeline as migration_role (tenant:create-workspace for a new workspace, tenant:create-pipeline for one made
-- before): app_role only reads them, never changes nor deletes a row. The default steps "Bước 1"…"Bước 6" and the one reason
-- "Khác (chờ Q9)" are stand-ins until Q9: no business name is written in code.
-- A step and a reason name no customer: support_role reads both tables whole.

CREATE TABLE public.pipeline_stages (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- For the pair foreign key of a lead: a lead never sits at a step of another workspace.
  CONSTRAINT pipeline_stages_org_workspace_id_key UNIQUE (org_id, workspace_id, id),
  CONSTRAINT pipeline_stages_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT pipeline_stages_workspace_fk FOREIGN KEY (org_id, workspace_id)
    REFERENCES public.workspaces (org_id, id) ON DELETE RESTRICT,
  -- One step a place in the workspace; also the order of the Kanban.
  CONSTRAINT pipeline_stages_position_key UNIQUE (org_id, workspace_id, position),
  CONSTRAINT pipeline_stages_position_check CHECK (position >= 0),
  -- 1 to 100 characters, trimmed, in NFC (as tags.name).
  CONSTRAINT pipeline_stages_name_check CHECK (
    btrim(name) = name AND name <> '' AND char_length(name) <= 100 AND name = normalize(name, NFC)
  )
);

-- A list of reasons is never edited: Q9 (or any later change) writes a whole new list with a later effective_from, and the list in force
-- is the rows of the latest effective_from not in the future. A lead keeps the words of its reason (leads.lost_reason), so an old list
-- can stay as it is.
CREATE TABLE public.pipeline_lost_reasons (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  position integer NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pipeline_lost_reasons_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT pipeline_lost_reasons_workspace_fk FOREIGN KEY (org_id, workspace_id)
    REFERENCES public.workspaces (org_id, id) ON DELETE RESTRICT,
  -- One reason a place in a list; also the read of the list in force, in order.
  CONSTRAINT pipeline_lost_reasons_position_key UNIQUE (org_id, workspace_id, effective_from, position),
  CONSTRAINT pipeline_lost_reasons_position_check CHECK (position >= 0),
  -- 1 to 200 characters (LeadClose.lostReason), trimmed, in NFC.
  CONSTRAINT pipeline_lost_reasons_name_check CHECK (
    btrim(name) = name AND name <> '' AND char_length(name) <= 200 AND name = normalize(name, NFC)
  )
);

-- One name a list, whatever the case: a reason typed two ways is one reason.
CREATE UNIQUE INDEX pipeline_lost_reasons_name_key
  ON public.pipeline_lost_reasons (org_id, workspace_id, effective_from, lower(name));

ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_stages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_lost_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_lost_reasons FORCE ROW LEVEL SECURITY;

-- Same shape as tickets_app (N75): the workspace test in USING and in WITH CHECK.
CREATE POLICY pipeline_stages_app ON public.pipeline_stages FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[]))
  WITH CHECK (org_id = (SELECT app.current_org())::uuid AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[]));
CREATE POLICY pipeline_stages_support ON public.pipeline_stages FOR SELECT TO support_role
  USING (
    org_id = (SELECT app.current_org())::uuid
    AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[])
    AND (SELECT app.support_access_ok())
  );
CREATE POLICY pipeline_lost_reasons_app ON public.pipeline_lost_reasons FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[]))
  WITH CHECK (org_id = (SELECT app.current_org())::uuid AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[]));
CREATE POLICY pipeline_lost_reasons_support ON public.pipeline_lost_reasons FOR SELECT TO support_role
  USING (
    org_id = (SELECT app.current_org())::uuid
    AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[])
    AND (SELECT app.support_access_ok())
  );

-- Read only for the API: no INSERT, UPDATE nor DELETE (Đợt 1 has no way to edit a pipeline; case 11).
GRANT SELECT ON public.pipeline_stages, public.pipeline_lost_reasons TO app_role, support_role;
