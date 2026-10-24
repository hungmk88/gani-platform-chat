-- rollback: compensating migration drops index channel_accounts_org_team_idx, constraint channel_accounts_team_fk, column team_id and constraint teams_org_id_workspace_id_id_key, and revokes UPDATE and SELECT on team_id; only before teams are given channels (N161).
-- The team that answers a channel (A4, spec-M8 §3.1 "Gán team phụ trách một kênh", endpoint-M8 §1, N161): at most one team per channel
-- account; a conversation of a channel without a team goes to the default team of the workspace (Brief §712). The foreign key names the
-- workspace too, so the database itself refuses a team of another workspace. Default MATCH SIMPLE: not checked while team_id is NULL. A
-- team ends with deleted_at, never a DELETE: the API refuses to end a team that still answers a channel (409 team_in_use). Both tables
-- are small: the constraints and the index are built inside the transaction.

-- Target of the foreign key below (as channel_accounts_org_workspace_id_key is for the tables that point at an account).
ALTER TABLE public.teams
  ADD CONSTRAINT teams_org_id_workspace_id_id_key UNIQUE (org_id, workspace_id, id);

ALTER TABLE public.channel_accounts
  ADD COLUMN team_id uuid,
  ADD CONSTRAINT channel_accounts_team_fk FOREIGN KEY (org_id, workspace_id, team_id)
    REFERENCES public.teams (org_id, workspace_id, id) ON DELETE RESTRICT;

-- The channels of a team: GET /v1/teams and the check before a team ends.
CREATE INDEX channel_accounts_org_team_idx ON public.channel_accounts (org_id, team_id) WHERE team_id IS NOT NULL;

-- app_role assigns the team; support_role reads it with the other metadata (never the four secret columns).
GRANT UPDATE (team_id) ON public.channel_accounts TO app_role;
GRANT SELECT (team_id) ON public.channel_accounts TO support_role;
