-- rollback: compensating migration drops trigger bot_flow_versions_guard, function app.bot_flow_versions_guard(), then tables
-- public.bot_flow_versions and public.bot_flows; only acceptable before any flow is published (D1a1a, N176).
-- bot_flows, bot_flow_versions: the scripted bot flows of a workspace (D1, Brief P13; data model M05: RLS O, `version` and soft
-- delete on flows, index (org_id, workspace_id, status)). A flow belongs to one workspace, RLS is by organisation like teams (M05
-- says O); the API checks the workspace is the session's. A flow ends with deleted_at. A version is a snapshot of the flow's graph
-- (its nodes and edges come in D1a1b): at most one draft per flow; a published version never changes again (Brief P13 "bất biến sau
-- publish"), nor does a discarded draft: the trigger refuses their UPDATE and DELETE for every role (BF001). Nothing is ever
-- deleted: app_role has no DELETE on any table (spec RLS M01 §2, case 11); a draft given up is marked discarded.

CREATE TABLE public.bot_flows (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  -- draft: never published; active: a published version runs; inactive: turned off, its versions kept.
  status text NOT NULL DEFAULT 'draft',
  -- Optimistic lock of the flow (M05 `version` ✓ flows); not the number of a published version.
  version integer NOT NULL DEFAULT 0,
  created_by uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bot_flows_org_id_key UNIQUE (org_id, id),
  CONSTRAINT bot_flows_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT bot_flows_workspace_fk FOREIGN KEY (org_id, workspace_id)
    REFERENCES public.workspaces (org_id, id) ON DELETE RESTRICT,
  -- Default MATCH SIMPLE: not checked when created_by IS NULL.
  CONSTRAINT bot_flows_created_by_fk FOREIGN KEY (org_id, created_by)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT bot_flows_name_check CHECK (btrim(name) <> '' AND char_length(name) <= 100),
  CONSTRAINT bot_flows_status_check CHECK (status IN ('draft', 'active', 'inactive')),
  CONSTRAINT bot_flows_version_check CHECK (version >= 0)
);

-- M05's index, for the live flows only.
CREATE INDEX bot_flows_workspace_status_idx ON public.bot_flows (org_id, workspace_id, status)
  WHERE deleted_at IS NULL;

CREATE TABLE public.bot_flow_versions (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  flow_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  -- The number of a published version (1, 2, …); none for a draft or a discarded draft.
  version integer,
  published_at timestamptz,
  published_by uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bot_flow_versions_org_id_key UNIQUE (org_id, id),
  CONSTRAINT bot_flow_versions_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT bot_flow_versions_flow_fk FOREIGN KEY (org_id, flow_id)
    REFERENCES public.bot_flows (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT bot_flow_versions_published_by_fk FOREIGN KEY (org_id, published_by)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT bot_flow_versions_created_by_fk FOREIGN KEY (org_id, created_by)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT bot_flow_versions_status_check CHECK (status IN ('draft', 'published', 'discarded')),
  -- Published means when, and with a number; a draft or a discarded draft has neither.
  CONSTRAINT bot_flow_versions_published_check CHECK ((status = 'published') = (published_at IS NOT NULL)),
  CONSTRAINT bot_flow_versions_number_check
    CHECK ((status = 'published') = (version IS NOT NULL) AND (version IS NULL OR version >= 1)),
  -- NULLs are distinct: drafts never collide here.
  CONSTRAINT bot_flow_versions_number_key UNIQUE (org_id, flow_id, version)
);

-- At most one draft per flow.
CREATE UNIQUE INDEX bot_flow_versions_draft_key ON public.bot_flow_versions (org_id, flow_id) WHERE status = 'draft';

-- BF001: a published version, or a discarded draft, is changed or deleted. Not SECURITY DEFINER (ADR-004 unchanged); no switch to
-- get past it: the purge of a deleted organisation (TenantPurgeJob) will need its own, in its own PR.
CREATE FUNCTION app.bot_flow_versions_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF OLD.status IN ('published', 'discarded') THEN
    RAISE EXCEPTION 'a published or discarded bot flow version never changes'
      USING ERRCODE = 'BF001', HINT = 'save a new draft version instead';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION app.bot_flow_versions_guard() FROM PUBLIC;

CREATE TRIGGER bot_flow_versions_guard BEFORE UPDATE OR DELETE ON public.bot_flow_versions
  FOR EACH ROW EXECUTE FUNCTION app.bot_flow_versions_guard();

ALTER TABLE public.bot_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_flows FORCE ROW LEVEL SECURITY;
ALTER TABLE public.bot_flow_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_flow_versions FORCE ROW LEVEL SECURITY;

CREATE POLICY bot_flows_app ON public.bot_flows FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);
CREATE POLICY bot_flows_support ON public.bot_flows FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));
CREATE POLICY bot_flow_versions_app ON public.bot_flow_versions FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);
CREATE POLICY bot_flow_versions_support ON public.bot_flow_versions FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));

-- id, org_id, workspace_id, flow_id and the created_* columns never change. No DELETE anywhere.
GRANT SELECT, INSERT ON public.bot_flows TO app_role;
GRANT UPDATE (name, status, version, deleted_at, updated_at) ON public.bot_flows TO app_role;
GRANT SELECT ON public.bot_flows TO support_role;
GRANT SELECT, INSERT ON public.bot_flow_versions TO app_role;
GRANT UPDATE (status, version, published_at, published_by, updated_at) ON public.bot_flow_versions TO app_role;
GRANT SELECT ON public.bot_flow_versions TO support_role;
