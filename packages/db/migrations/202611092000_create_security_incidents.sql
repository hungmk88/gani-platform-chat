-- rollback: compensating migration drops tables public.security_alerts and public.security_incidents; only acceptable before any alert or incident exists.
-- security_alerts and security_incidents: P11, the security alerts of an organisation and the incidents opened from them (U35, N167,
-- N207). RLS by organisation only: an alert is about the whole company (a member, a channel account), not one workspace. Codes and ids
-- only, never an email, a phone or an address (CLAUDE.md rule 5); the title of an incident is the opener's free words. Nothing is ever
-- deleted (no DELETE grant). support_role reads both inside an access session, like every tenant table, but never the title.
-- An incident is opened by a member (Owner, Admin) or by a platform operator inside an access session (Phụ lục B, N207 B1): exactly one
-- of the two columns. An operator is not a member, so their column points at users, not org_members. Who handles it is always an
-- active Owner or Admin of the organisation: the pair key says member, the role is the store's check.

CREATE TABLE public.security_incidents (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  title text NOT NULL,
  severity text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  handler_user_id uuid NOT NULL,
  opened_by_user_id uuid,
  opened_by_operator_id uuid,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_incidents_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT security_incidents_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT security_incidents_handler_fk FOREIGN KEY (org_id, handler_user_id)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT security_incidents_opened_by_user_fk FOREIGN KEY (org_id, opened_by_user_id)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT security_incidents_opened_by_operator_fk FOREIGN KEY (opened_by_operator_id)
    REFERENCES public.users (id) ON DELETE RESTRICT,
  CONSTRAINT security_incidents_opener_check CHECK (num_nonnulls(opened_by_user_id, opened_by_operator_id) = 1),
  CONSTRAINT security_incidents_title_check CHECK (btrim(title) <> '' AND char_length(title) <= 200),
  CONSTRAINT security_incidents_severity_check CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT security_incidents_status_check CHECK (status IN ('open', 'closed')),
  -- Both ways: a closed incident has its time, an open one has none.
  CONSTRAINT security_incidents_closed_check CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);

-- The list: newest first (UUIDv7 ids), by status.
CREATE INDEX security_incidents_org_status_idx ON public.security_incidents (org_id, status, id DESC);

CREATE TABLE public.security_alerts (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  kind text NOT NULL,
  severity text NOT NULL,
  -- Who or what it is about. No foreign key on subject_user_id: the subject of `platform_access` is an operator, not a member, and
  -- the alert outlives the membership (as audit_logs.actor_user_id).
  subject_user_id uuid,
  channel_account_id uuid,
  -- One alert per kind, subject and window (15 minutes of failed sign-ins, an hour of bad signatures): a repeat raises count.
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 1,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  incident_id uuid,
  CONSTRAINT security_alerts_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT security_alerts_channel_account_fk FOREIGN KEY (org_id, channel_account_id)
    REFERENCES public.channel_accounts (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT security_alerts_incident_fk FOREIGN KEY (org_id, incident_id)
    REFERENCES public.security_incidents (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT security_alerts_window_key UNIQUE NULLS NOT DISTINCT (org_id, kind, subject_user_id, channel_account_id, window_start),
  CONSTRAINT security_alerts_kind_check CHECK (kind IN ('login_failures', 'two_factor_locked', 'two_factor_reset', 'platform_access',
    'webhook_signature_invalid', 'bulk_export')),
  CONSTRAINT security_alerts_severity_check CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT security_alerts_count_check CHECK (count >= 1)
);

-- The list: newest first; the alerts of one incident.
CREATE INDEX security_alerts_org_idx ON public.security_alerts (org_id, id DESC);
CREATE INDEX security_alerts_incident_idx ON public.security_alerts (org_id, incident_id) WHERE incident_id IS NOT NULL;

ALTER TABLE public.security_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_incidents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.security_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_alerts FORCE ROW LEVEL SECURITY;

CREATE POLICY security_incidents_app ON public.security_incidents FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);
CREATE POLICY security_alerts_app ON public.security_alerts FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);

CREATE POLICY security_incidents_support ON public.security_incidents FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));
CREATE POLICY security_alerts_support ON public.security_alerts FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));

-- An incident: closed once, or handed to someone else. An alert: a repeat in its window, and the incident that covers it.
GRANT SELECT, INSERT ON public.security_incidents, public.security_alerts TO app_role;
GRANT UPDATE (status, closed_at, handler_user_id, updated_at) ON public.security_incidents TO app_role;
GRANT UPDATE (count, occurred_at, severity, incident_id) ON public.security_alerts TO app_role;
GRANT SELECT ON public.security_alerts TO support_role;
GRANT SELECT (id, org_id, severity, status, handler_user_id, opened_by_user_id, opened_by_operator_id, opened_at, closed_at, updated_at)
  ON public.security_incidents TO support_role;
