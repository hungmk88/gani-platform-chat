-- rollback: compensating migration drops tables public.customer_tags and public.tags; only before a person tags a customer.
-- The tags of an organisation (J4, T-4/U47, U36, N190; Tag 2a-i, CEO 02/11/2026): one set for the whole company, so RLS by organisation
-- only, and the tags each customer has. A tag ends with deleted_at (a merge deletes its source softly, CEO 02/11 answer 2), never a
-- DELETE; its name is free again then. hidden is the tag's own flag (T-4): no customer gets it any more, those who have it keep it.
-- A customer loses a tag by deleted_at too: app_role has no DELETE anywhere (spec RLS M01 §7 case 11, kept by the CEO 02/11/2026 over a
-- DELETE on this table); tagging again turns the same row back on, so one row per customer and tag, live or not.
-- At most 500 live tags a company: the store counts them under a lock, not a constraint. A tag name is not personal data: support_role
-- reads both tables whole.

CREATE TABLE public.tags (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  name text NOT NULL,
  hidden boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tags_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT tags_org_id_id_key UNIQUE (org_id, id),
  -- 1 to 50 characters, trimmed, in NFC so that one name typed two ways is one tag (as customers.display_name, 202611010900).
  CONSTRAINT tags_name_check CHECK (
    btrim(name) = name AND name <> '' AND char_length(name) <= 50 AND name = normalize(name, NFC)
  )
);

-- One live tag per name in the company, whatever the case (409 duplicate_resource); a deleted one frees its name. Also the list by name.
CREATE UNIQUE INDEX tags_org_name_key ON public.tags (org_id, lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE public.customer_tags (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_tags_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT customer_tags_customer_fk FOREIGN KEY (org_id, customer_id)
    REFERENCES public.customers (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT customer_tags_tag_fk FOREIGN KEY (org_id, tag_id) REFERENCES public.tags (org_id, id) ON DELETE RESTRICT,
  -- One row per customer and tag, live or not: tagging again turns it back on.
  CONSTRAINT customer_tags_key UNIQUE (org_id, customer_id, tag_id)
);

-- The customers of a tag (filter tagId, customerCount, merge).
CREATE INDEX customer_tags_tag_idx ON public.customer_tags (org_id, tag_id) WHERE deleted_at IS NULL;

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags FORCE ROW LEVEL SECURITY;
ALTER TABLE public.customer_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_tags FORCE ROW LEVEL SECURITY;

CREATE POLICY tags_app ON public.tags FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);
CREATE POLICY tags_support ON public.tags FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));
CREATE POLICY customer_tags_app ON public.customer_tags FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);
CREATE POLICY customer_tags_support ON public.customer_tags FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));

-- id, org_id and what a row links never change; no DELETE (case 11).
GRANT SELECT, INSERT ON public.tags TO app_role;
GRANT UPDATE (name, hidden, deleted_at, updated_at) ON public.tags TO app_role;
GRANT SELECT, INSERT ON public.customer_tags TO app_role;
GRANT UPDATE (deleted_at, updated_at) ON public.customer_tags TO app_role;
GRANT SELECT ON public.tags, public.customer_tags TO support_role;
