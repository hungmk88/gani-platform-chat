-- rollback: compensating migration drops table public.platform_access_logs and its partitions; only acceptable before real access sessions exist.
-- platform_access_logs: support access sessions (spec RLS M01 §3.4, §4.9), partitioned by month. app_role has NO privilege
-- on it, so a tenant cannot see which operators looked at its data (N69, stricter than the §5 matrix); the org policy is a
-- second lock. A later sprint's access-session function writes rows; support_role reads via app.support_access_ok() (PR 4b).

CREATE TABLE public.platform_access_logs (
  id uuid NOT NULL,
  org_id uuid NOT NULL,
  operator_user_id uuid NOT NULL,
  db_login text NOT NULL,
  reason text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_access_logs_pkey PRIMARY KEY (id, created_at),
  CONSTRAINT platform_access_logs_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT platform_access_logs_db_login_check CHECK (btrim(db_login) <> ''),
  CONSTRAINT platform_access_logs_reason_check CHECK (btrim(reason) <> ''),
  -- At most 60 minutes (Brief P16); N69 records that this may be relaxed.
  CONSTRAINT platform_access_logs_expiry_check CHECK (expires_at > created_at AND expires_at <= created_at + interval '60 minutes')
) PARTITION BY RANGE (created_at);

CREATE INDEX platform_access_logs_org_created_idx ON public.platform_access_logs (org_id, created_at);

ALTER TABLE public.platform_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_access_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_access_logs_app ON public.platform_access_logs FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);

-- Deliberately no GRANT to app_role. support_role gets SELECT and its policy in PR 4b.

SELECT app.create_log_partitions('public.platform_access_logs', 2);
