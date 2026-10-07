-- rollback: compensating migration drops table public.channel_accounts; only acceptable before real channel accounts exist (rows are soft deleted, never removed).
-- channel_accounts: the accounts of the channels of an organisation, here the Zalo OA of a workspace (Brief P8 M02, zalo-channel-spec §1).
-- RLS by organisation (O). The secrets of the channel live in the columns ending in _enc: bytea holding nonce(12) || tag(16) || ciphertext
-- made by SecretBox (AES-256-GCM, AAD = id of the row + name of the column, key_version tells which master key). The database cannot tell
-- a ciphertext from a plain text: the CHECK of 28 bytes only refuses an empty or truncated value. What keeps the secrets safe is that the
-- application never writes a plain value (SecretBox, tested in its own PR) and that support_role is never granted these columns.
-- Every secret column is nullable and independent on purpose (Z2): which one signs the webhook is the decision of the code, so a
-- different answer from the Zalo documentation is a small expand migration, not a rewrite of this table.

CREATE TABLE public.channel_accounts (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  type text NOT NULL,
  -- The id of the account at the platform (the id of the OA). Never changes after creation.
  external_account_id text NOT NULL,
  display_name text NOT NULL,
  -- The id of the Zalo application: not a secret (it is part of the signature formula).
  app_id text,
  app_secret_enc bytea,
  oa_secret_key_enc bytea,
  access_token_enc bytea,
  refresh_token_enc bytea,
  key_version integer NOT NULL DEFAULT 1,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  last_refreshed_at timestamptz,
  -- Lease of the job that refreshes the tokens: a refresh token may be used once, so two workers must not refresh one account.
  refresh_claimed_at timestamptz,
  status text NOT NULL DEFAULT 'disconnected',
  -- A code, not a message: it cannot carry a token or a person's data (as outbox_events.last_error).
  last_error text,
  created_by uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT channel_accounts_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  -- An account can only sit in a workspace of its own organisation.
  CONSTRAINT channel_accounts_workspace_fk FOREIGN KEY (org_id, workspace_id)
    REFERENCES public.workspaces (org_id, id) ON DELETE RESTRICT,
  -- Default MATCH SIMPLE: not checked when created_by IS NULL.
  CONSTRAINT channel_accounts_created_by_fk FOREIGN KEY (org_id, created_by)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT,
  -- Target of the composite foreign keys of the tables that point at an account (inbound_events, conversations).
  CONSTRAINT channel_accounts_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT channel_accounts_type_check CHECK (type IN ('zalo_oa', 'facebook', 'webchat')),
  CONSTRAINT channel_accounts_external_account_id_check CHECK (btrim(external_account_id) <> ''),
  CONSTRAINT channel_accounts_display_name_check CHECK (btrim(display_name) <> ''),
  CONSTRAINT channel_accounts_app_id_check CHECK (app_id IS NULL OR btrim(app_id) <> ''),
  CONSTRAINT channel_accounts_app_secret_enc_check CHECK (app_secret_enc IS NULL OR octet_length(app_secret_enc) >= 28),
  CONSTRAINT channel_accounts_oa_secret_key_enc_check CHECK (oa_secret_key_enc IS NULL OR octet_length(oa_secret_key_enc) >= 28),
  CONSTRAINT channel_accounts_access_token_enc_check CHECK (access_token_enc IS NULL OR octet_length(access_token_enc) >= 28),
  CONSTRAINT channel_accounts_refresh_token_enc_check CHECK (refresh_token_enc IS NULL OR octet_length(refresh_token_enc) >= 28),
  CONSTRAINT channel_accounts_key_version_check CHECK (key_version >= 1),
  CONSTRAINT channel_accounts_status_check CHECK (status IN ('connected', 'token_expiring', 'disconnected')),
  CONSTRAINT channel_accounts_last_error_check CHECK (last_error IS NULL OR (btrim(last_error) <> '' AND char_length(last_error) <= 64))
);

-- Global on purpose (Brief P8): one account at the platform belongs to one organisation. Partial: a deleted account (soft delete)
-- does not hold the name, so the same OA can be connected again, in this organisation or in another.
CREATE UNIQUE INDEX channel_accounts_type_external_account_id_key
  ON public.channel_accounts (type, external_account_id) WHERE deleted_at IS NULL;

-- Not unique (Z1): a workspace can have more than one account of a type.
CREATE INDEX channel_accounts_org_workspace_type_idx ON public.channel_accounts (org_id, workspace_id, type);

ALTER TABLE public.channel_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY channel_accounts_app ON public.channel_accounts FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);

CREATE POLICY channel_accounts_support ON public.channel_accounts FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));

-- No DELETE (soft delete). UPDATE by column: org_id, workspace_id, type, external_account_id, app_id and created_* never change;
-- connecting the same OA to another workspace is a new account.
GRANT SELECT, INSERT ON public.channel_accounts TO app_role;
GRANT UPDATE (display_name, app_secret_enc, oa_secret_key_enc, access_token_enc, refresh_token_enc, key_version,
  access_token_expires_at, refresh_token_expires_at, last_refreshed_at, refresh_claimed_at, status, last_error, deleted_at, updated_at)
  ON public.channel_accounts TO app_role;

-- support_role reads the metadata only. The list names every allowed column, so a column added later stays hidden until a migration
-- shows it, and the four secret columns are never in it (as key_hash of api_keys, N71).
GRANT SELECT (id, org_id, workspace_id, type, external_account_id, display_name, app_id, key_version, access_token_expires_at,
  refresh_token_expires_at, last_refreshed_at, refresh_claimed_at, status, last_error, created_by, deleted_at, created_at, updated_at)
  ON public.channel_accounts TO support_role;
