-- rollback: compensating migration drops table public.audit_logs and its partitions; only acceptable before real audit data exists (the table is append-only and rows are never removed).
-- audit_logs: who did what in an organisation (spec RLS M01 §4.9), partitioned by month, append-only for app_role.
-- No foreign key on actor_user_id or target_id: the log outlives what it describes. detail holds no PII (review checks).

CREATE TABLE public.audit_logs (
  id uuid NOT NULL,
  org_id uuid NOT NULL,
  actor_user_id uuid,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id, created_at),
  CONSTRAINT audit_logs_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT audit_logs_action_check CHECK (btrim(action) <> ''),
  CONSTRAINT audit_logs_detail_object CHECK (jsonb_typeof(detail) = 'object')
) PARTITION BY RANGE (created_at);

CREATE INDEX audit_logs_org_created_idx ON public.audit_logs (org_id, created_at);
CREATE INDEX audit_logs_actor_idx ON public.audit_logs (org_id, actor_user_id, created_at DESC);
CREATE INDEX audit_logs_target_idx ON public.audit_logs (org_id, target_type, target_id, created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_logs_app ON public.audit_logs FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);

-- No UPDATE, DELETE or TRUNCATE: the log is append-only. The support_role policy comes with PR 4b (N57).
GRANT SELECT, INSERT ON public.audit_logs TO app_role;

SELECT app.create_log_partitions('public.audit_logs', 2);
