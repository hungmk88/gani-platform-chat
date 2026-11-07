-- rollback: compensating migration drops tables public.customer_merge_moves and public.customer_merges, columns customers.merged_into and customers.merged_at, and revokes the UPDATE (customer_id) grants below; only before any customer is merged.
-- The merge of duplicate customers (J3, Brief P9 lines 443 and 464, N197, N204; CEO 06/11/2026). A merge moves what belongs to the
-- source to the target and logs every row it moved, so an unmerge gives back exactly those rows; what was made after the merge
-- stays with the target. The source is never deleted: merged_into hides it from the lists while the merge holds. RLS by
-- organisation only, as customers: a merge reaches every live workspace of the organisation (N204), the store's work.
-- customer_merges keeps who and when, and which empty fields of the target were filled from the source (filled_fields), so the
-- unmerge clears them again; no name, phone or email is copied into these tables (CLAUDE.md rule 5).
-- customer_merge_moves names a moved row by its table and id. table_name is checked against a fixed list here, and the store maps
-- it to a table through the same list in code: it never reaches SQL as an identifier.

ALTER TABLE public.customers
  ADD COLUMN merged_into uuid,
  ADD COLUMN merged_at timestamptz,
  -- NO ACTION, not RESTRICT, for this key of the table to itself only: checked at the end of the statement, so one DELETE of an
  -- organisation's test rows may take a source and its target together. Customers are never deleted in the application (deleted_at).
  ADD CONSTRAINT customers_merged_into_fk FOREIGN KEY (org_id, merged_into)
    REFERENCES public.customers (org_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT customers_merged_into_check CHECK (merged_into <> id),
  -- Merged exactly while it has a time of merge.
  ADD CONSTRAINT customers_merged_at_check CHECK ((merged_into IS NULL) = (merged_at IS NULL));

CREATE TABLE public.customer_merges (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  source_id uuid NOT NULL,
  target_id uuid NOT NULL,
  merged_by uuid NOT NULL,
  merged_at timestamptz NOT NULL DEFAULT now(),
  filled_fields text[] NOT NULL DEFAULT '{}',
  unmerged_by uuid,
  unmerged_at timestamptz,
  CONSTRAINT customer_merges_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT customer_merges_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT customer_merges_source_fk FOREIGN KEY (org_id, source_id)
    REFERENCES public.customers (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT customer_merges_target_fk FOREIGN KEY (org_id, target_id)
    REFERENCES public.customers (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT customer_merges_merged_by_fk FOREIGN KEY (org_id, merged_by)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT customer_merges_unmerged_by_fk FOREIGN KEY (org_id, unmerged_by)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT customer_merges_distinct_check CHECK (source_id <> target_id),
  CONSTRAINT customer_merges_filled_fields_check CHECK (filled_fields <@ ARRAY['display_name', 'phone_e164', 'email']),
  -- Undone exactly when it has who undid it and when.
  CONSTRAINT customer_merges_unmerged_check CHECK ((unmerged_at IS NULL) = (unmerged_by IS NULL))
);

-- At most one merge that holds per source; the merges into a customer, newest first (GET /v1/customers/{id}/merges).
CREATE UNIQUE INDEX customer_merges_live_source_key ON public.customer_merges (org_id, source_id) WHERE unmerged_at IS NULL;
CREATE INDEX customer_merges_target_idx ON public.customer_merges (org_id, target_id, merged_at DESC, id DESC);

CREATE TABLE public.customer_merge_moves (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  merge_id uuid NOT NULL,
  table_name text NOT NULL,
  row_id uuid NOT NULL,
  CONSTRAINT customer_merge_moves_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT customer_merge_moves_merge_fk FOREIGN KEY (org_id, merge_id)
    REFERENCES public.customer_merges (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT customer_merge_moves_table_check CHECK (table_name IN (
    'conversations', 'customer_identities', 'tickets', 'leads', 'customer_tags', 'customer_field_values'
  )),
  CONSTRAINT customer_merge_moves_key UNIQUE (org_id, merge_id, table_name, row_id)
);

ALTER TABLE public.customer_merges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_merges FORCE ROW LEVEL SECURITY;
ALTER TABLE public.customer_merge_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_merge_moves FORCE ROW LEVEL SECURITY;

CREATE POLICY customer_merges_app ON public.customer_merges FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);
CREATE POLICY customer_merges_support ON public.customer_merges FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));
CREATE POLICY customer_merge_moves_app ON public.customer_merge_moves FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);
CREATE POLICY customer_merge_moves_support ON public.customer_merge_moves FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));

-- A merge moves rows to the target and an unmerge moves them back: only customer_id changes. No DELETE anywhere. The log is written
-- once; an unmerge only marks it undone.
GRANT UPDATE (merged_into, merged_at) ON public.customers TO app_role;
GRANT UPDATE (customer_id) ON public.customer_identities, public.tickets, public.leads, public.customer_tags,
  public.customer_field_values TO app_role;
GRANT SELECT, INSERT ON public.customer_merges, public.customer_merge_moves TO app_role;
GRANT UPDATE (unmerged_by, unmerged_at) ON public.customer_merges TO app_role;
GRANT SELECT (merged_into, merged_at) ON public.customers TO support_role;
GRANT SELECT ON public.customer_merges, public.customer_merge_moves TO support_role;
