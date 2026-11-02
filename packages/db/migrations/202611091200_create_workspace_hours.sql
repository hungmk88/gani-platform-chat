-- rollback: compensating migration drops tables public.workspace_holidays and public.workspace_hours; only before an admin sets them.
-- The working hours of a workspace and its days off (C10, Q7, U44, N192; CEO 02/11/2026): out of hours a conversation that needs a
-- person is held (after_hours_hold, FSM P14) until opening. RLS by organisation, like workspaces and teams; the API names the workspace.
-- A workspace with no row here works the default of the code (08:00–18:00, Monday to Friday, Q7), so nothing is seeded; and no day off
-- is known until an admin enters it (CEO 02/11: no list of holidays in the database). A week is seven rows, one per ISO weekday
-- (1 = Monday), a closed day having no hours; the lunch break is set per day (U44). A day off ends with deleted_at, never a DELETE
-- (spec RLS M01 §7 case 11). Overlapping days off (422 holiday_overlap) and a day off that has ended (422 holiday_in_past) are the
-- store's checks, in the time zone of the workspace. Neither table holds personal data: support_role reads both.

CREATE TABLE public.workspace_hours (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  weekday smallint NOT NULL,
  opens_at time,
  closes_at time,
  break_starts_at time,
  break_ends_at time,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_hours_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT workspace_hours_workspace_fk FOREIGN KEY (org_id, workspace_id)
    REFERENCES public.workspaces (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT workspace_hours_key UNIQUE (org_id, workspace_id, weekday),
  CONSTRAINT workspace_hours_weekday_check CHECK (weekday BETWEEN 1 AND 7),
  -- Open (both hours, opening first) or closed (neither); a break needs both ends, inside the day. Every comparison names its
  -- operands NOT NULL first: a comparison with NULL is NULL, and a CHECK lets NULL through.
  CONSTRAINT workspace_hours_day_check CHECK (
    (opens_at IS NULL AND closes_at IS NULL AND break_starts_at IS NULL AND break_ends_at IS NULL)
    OR (opens_at IS NOT NULL AND closes_at IS NOT NULL AND opens_at < closes_at AND (
      (break_starts_at IS NULL AND break_ends_at IS NULL)
      OR (break_starts_at IS NOT NULL AND break_ends_at IS NOT NULL
        AND opens_at < break_starts_at AND break_starts_at < break_ends_at AND break_ends_at < closes_at)
    ))
  )
);

CREATE TABLE public.workspace_holidays (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_holidays_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT workspace_holidays_workspace_fk FOREIGN KEY (org_id, workspace_id)
    REFERENCES public.workspaces (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT workspace_holidays_name_check CHECK (
    btrim(name) = name AND name <> '' AND char_length(name) <= 100 AND name = normalize(name, NFC)
  ),
  -- One day (starts_on = ends_on) or a range, such as Tết.
  CONSTRAINT workspace_holidays_range_check CHECK (starts_on <= ends_on)
);

-- The days off of a workspace by date: the list, the overlap check and isOpen.
CREATE INDEX workspace_holidays_workspace_idx ON public.workspace_holidays (org_id, workspace_id, starts_on)
  WHERE deleted_at IS NULL;

ALTER TABLE public.workspace_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_hours FORCE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_holidays FORCE ROW LEVEL SECURITY;

CREATE POLICY workspace_hours_app ON public.workspace_hours FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);
CREATE POLICY workspace_hours_support ON public.workspace_hours FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));
CREATE POLICY workspace_holidays_app ON public.workspace_holidays FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);
CREATE POLICY workspace_holidays_support ON public.workspace_holidays FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));

-- id, org_id, the workspace and the weekday never change; no DELETE (case 11).
GRANT SELECT, INSERT ON public.workspace_hours TO app_role;
GRANT UPDATE (opens_at, closes_at, break_starts_at, break_ends_at, updated_at) ON public.workspace_hours TO app_role;
GRANT SELECT, INSERT ON public.workspace_holidays TO app_role;
GRANT UPDATE (name, starts_on, ends_on, deleted_at, updated_at) ON public.workspace_holidays TO app_role;
GRANT SELECT ON public.workspace_hours, public.workspace_holidays TO support_role;
