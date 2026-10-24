-- rollback: compensating migration drops index teams_one_default_per_workspace, the two CHECKs and the columns is_default and description, and revokes UPDATE on them; only before teams use them (N160).
-- Team (A4, spec-M8 §3.1, endpoint-M8 §1, N160): a team has a description and may be the default one of its workspace (it takes the
-- conversations no other rule sends anywhere). At most one live default per workspace, kept by a partial unique index; a company-wide
-- team (workspace_id NULL, N14) is never a default. The teams table is small: the index is built inside the transaction.

ALTER TABLE public.teams
  ADD COLUMN description text,
  ADD COLUMN is_default boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT teams_description_check CHECK (description IS NULL OR char_length(description) <= 500),
  ADD CONSTRAINT teams_default_workspace_check CHECK (NOT is_default OR workspace_id IS NOT NULL);

CREATE UNIQUE INDEX teams_one_default_per_workspace ON public.teams (org_id, workspace_id)
  WHERE is_default AND deleted_at IS NULL;

-- Added to the columns app_role may UPDATE (name, slug, deleted_at, updated_at); id, org_id, workspace_id and created_by still never change.
GRANT UPDATE (description, is_default) ON public.teams TO app_role;
