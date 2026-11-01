-- rollback: compensating migration drops triggers bot_edges_guard and bot_nodes_guard, function app.bot_graph_guard(), then tables
-- public.bot_edges and public.bot_nodes; only acceptable before any flow is published (D1a1b, N177).
-- bot_nodes, bot_edges: the graph of a bot flow version (D1, Brief P13; data model M05: RLS O). A node and an edge belong to one
-- version, and an edge joins two nodes of that same version: the foreign keys are by (org_id, version_id, node id), so an edge
-- never reaches a node of another version or of another organisation. The node types are those of Đợt 1 (Brief P13 and its
-- Bổ sung): `ai_answer` is Đợt 2 and `wait_for_event` is out of scope, the CHECK refuses both. A graph is written once, while its
-- version is a draft: the trigger refuses any INSERT, UPDATE or DELETE of a node or an edge of a published version or a discarded
-- draft, for every role (BF001, the code of bot_flow_versions_guard). Saving a draft makes a new draft version (D1a2), so app_role
-- only reads and inserts here: no UPDATE, no DELETE (spec RLS M01 §2, case 11).

CREATE TABLE public.bot_nodes (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  version_id uuid NOT NULL,
  -- The author's name of the node, unique in its version and kept from one version to the next (the form builder, U16).
  key text NOT NULL,
  type text NOT NULL,
  -- The settings of the node, by type (message template, question kind, condition…); checked by the API (D1a3), never logged.
  config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bot_nodes_org_id_key UNIQUE (org_id, id),
  CONSTRAINT bot_nodes_version_node_key UNIQUE (org_id, version_id, id),
  CONSTRAINT bot_nodes_version_key_key UNIQUE (org_id, version_id, key),
  CONSTRAINT bot_nodes_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT bot_nodes_version_fk FOREIGN KEY (org_id, version_id)
    REFERENCES public.bot_flow_versions (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT bot_nodes_key_check CHECK (key ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT bot_nodes_type_check CHECK (type IN ('trigger', 'message', 'question', 'condition', 'set_variable', 'collect',
    'tag', 'api_call', 'delay', 'handoff', 'jump_to_flow', 'end')),
  CONSTRAINT bot_nodes_config_check CHECK (jsonb_typeof(config) = 'object')
);

-- At most one trigger per version; "exactly one" is checked when a draft is saved (D1a2).
CREATE UNIQUE INDEX bot_nodes_trigger_key ON public.bot_nodes (org_id, version_id) WHERE type = 'trigger';

CREATE TABLE public.bot_edges (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  version_id uuid NOT NULL,
  from_node_id uuid NOT NULL,
  to_node_id uuid NOT NULL,
  -- The branch it stands for (a choice of a question, an outcome of a condition); none for the only way on.
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bot_edges_org_id_key UNIQUE (org_id, id),
  CONSTRAINT bot_edges_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT bot_edges_version_fk FOREIGN KEY (org_id, version_id)
    REFERENCES public.bot_flow_versions (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT bot_edges_from_fk FOREIGN KEY (org_id, version_id, from_node_id)
    REFERENCES public.bot_nodes (org_id, version_id, id) ON DELETE RESTRICT,
  CONSTRAINT bot_edges_to_fk FOREIGN KEY (org_id, version_id, to_node_id)
    REFERENCES public.bot_nodes (org_id, version_id, id) ON DELETE RESTRICT,
  CONSTRAINT bot_edges_label_check CHECK (label IS NULL OR (btrim(label) <> '' AND char_length(label) <= 100))
);

-- The FKs from bot_edges to bot_nodes are served by bot_nodes_version_node_key; these serve the lookups of a node's edges.
CREATE INDEX bot_edges_from_idx ON public.bot_edges (org_id, version_id, from_node_id);
CREATE INDEX bot_edges_to_idx ON public.bot_edges (org_id, version_id, to_node_id);

-- BF001: a node or an edge of a published version or a discarded draft is inserted, changed or deleted. The version is read FOR
-- SHARE, so a publish (an UPDATE of the version) waits for the transaction writing the graph, and a write that comes after a
-- publish sees it. An old row whose version cannot be read is refused too. A new row whose version is not found is let through:
-- the foreign key refuses a version that does not exist, the policy one of another organisation. Not SECURITY DEFINER (ADR-004
-- unchanged); FOR SHARE needs the UPDATE app_role has on some columns of bot_flow_versions, and its policy.
CREATE FUNCTION app.bot_graph_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_status text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT v.status INTO v_status FROM public.bot_flow_versions v
      WHERE v.org_id = OLD.org_id AND v.id = OLD.version_id FOR SHARE;
    IF v_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'the graph of a published or discarded bot flow version never changes'
        USING ERRCODE = 'BF001', HINT = 'save a new draft version instead';
    END IF;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
  END IF;
  SELECT v.status INTO v_status FROM public.bot_flow_versions v
    WHERE v.org_id = NEW.org_id AND v.id = NEW.version_id FOR SHARE;
  IF v_status IN ('published', 'discarded') THEN
    RAISE EXCEPTION 'the graph of a published or discarded bot flow version never changes'
      USING ERRCODE = 'BF001', HINT = 'save a new draft version instead';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION app.bot_graph_guard() FROM PUBLIC;

CREATE TRIGGER bot_nodes_guard BEFORE INSERT OR UPDATE OR DELETE ON public.bot_nodes
  FOR EACH ROW EXECUTE FUNCTION app.bot_graph_guard();
CREATE TRIGGER bot_edges_guard BEFORE INSERT OR UPDATE OR DELETE ON public.bot_edges
  FOR EACH ROW EXECUTE FUNCTION app.bot_graph_guard();

ALTER TABLE public.bot_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_nodes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.bot_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_edges FORCE ROW LEVEL SECURITY;

CREATE POLICY bot_nodes_app ON public.bot_nodes FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);
CREATE POLICY bot_nodes_support ON public.bot_nodes FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));
CREATE POLICY bot_edges_app ON public.bot_edges FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);
CREATE POLICY bot_edges_support ON public.bot_edges FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));

-- Written once: no UPDATE, no DELETE.
GRANT SELECT, INSERT ON public.bot_nodes TO app_role;
GRANT SELECT ON public.bot_nodes TO support_role;
GRANT SELECT, INSERT ON public.bot_edges TO app_role;
GRANT SELECT ON public.bot_edges TO support_role;
