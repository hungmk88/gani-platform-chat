-- rollback: compensating migration drops column conversations.customer_id (and its constraint), tables public.customer_identities and public.customers; only before an agent edits a customer (N165).
-- The customer of an organisation (CRM, J1/J2, Brief §360 M03, N165): one profile for the whole company, so RLS by organisation only,
-- and the identities a channel knows them by. Đợt 1 has one kind of identity, the Zalo user id, which Zalo gives per OA (Brief §543):
-- the channel account is part of the key, so the same person on two OAs of the company is two identities of, until merged (J3), two
-- customers. phone_e164 and email are not unique for the same reason: duplicates wait for the merge. A customer ends with deleted_at,
-- never a DELETE. The inbound worker finds or makes the customer of a message under the lock of the contact (lockContact) and fills
-- conversations.customer_id; a conversation older than this migration gets it at its next message, so no data is moved here.
-- support_role reads what is not personal data: no name, phone, email or external id (as conversations.external_user_id, N69).

CREATE TABLE public.customers (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  display_name text,
  phone_e164 text,
  email text,
  human_only boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT customers_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT customers_display_name_check CHECK (btrim(display_name) <> '' AND char_length(display_name) <= 200),
  -- E.164: a plus and 8 to 15 digits; the API turns 0912 345 678 into +84912345678 (Brief §158).
  CONSTRAINT customers_phone_check CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT customers_email_check CHECK (
    email = lower(email) AND char_length(email) <= 254 AND email ~ '^[^\s@]+@[^\s@]+$'
  )
);

-- The list of customers (newest first, UUIDv7) and the search by phone or email of one organisation.
CREATE INDEX customers_org_id_idx ON public.customers (org_id, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX customers_org_phone_idx ON public.customers (org_id, phone_e164) WHERE phone_e164 IS NOT NULL;
CREATE INDEX customers_org_email_idx ON public.customers (org_id, email) WHERE email IS NOT NULL;

CREATE TABLE public.customer_identities (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  identity_type text NOT NULL,
  channel_account_id uuid,
  external_id text NOT NULL,
  verification text NOT NULL DEFAULT 'unverified',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_identities_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT customer_identities_customer_fk FOREIGN KEY (org_id, customer_id)
    REFERENCES public.customers (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT customer_identities_channel_fk FOREIGN KEY (org_id, channel_account_id)
    REFERENCES public.channel_accounts (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT customer_identities_type_check CHECK (identity_type IN ('zalo_uid')),
  -- An id of a channel names its channel account.
  CONSTRAINT customer_identities_channel_check CHECK (identity_type <> 'zalo_uid' OR channel_account_id IS NOT NULL),
  CONSTRAINT customer_identities_external_id_check CHECK (external_id <> '' AND char_length(external_id) <= 128),
  CONSTRAINT customer_identities_verification_check
    CHECK (verification IN ('verified', 'unverified', 'sales_confirmed'))
);

-- One customer per identity. NULLS NOT DISTINCT: an identity without a channel (a phone, later) is unique in the organisation too.
CREATE UNIQUE INDEX customer_identities_key ON public.customer_identities
  (org_id, identity_type, channel_account_id, external_id) NULLS NOT DISTINCT;
CREATE INDEX customer_identities_customer_idx ON public.customer_identities (org_id, customer_id);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.customer_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_identities FORCE ROW LEVEL SECURITY;

CREATE POLICY customers_app ON public.customers FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);
CREATE POLICY customers_support ON public.customers FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));
CREATE POLICY customer_identities_app ON public.customer_identities FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid)
  WITH CHECK (org_id = (SELECT app.current_org())::uuid);
CREATE POLICY customer_identities_support ON public.customer_identities FOR SELECT TO support_role
  USING (org_id = (SELECT app.current_org())::uuid AND (SELECT app.support_access_ok()));

-- The conversation's customer. Default MATCH SIMPLE: not checked while customer_id is NULL. Its index is built CONCURRENTLY by the next
-- file (conversations is a table of the Inbox).
ALTER TABLE public.conversations
  ADD COLUMN customer_id uuid,
  ADD CONSTRAINT conversations_customer_fk FOREIGN KEY (org_id, customer_id)
    REFERENCES public.customers (org_id, id) ON DELETE RESTRICT;

-- id and org_id never change; an identity is not edited yet (the merge of J3 will grant what it needs). No DELETE.
GRANT SELECT, INSERT ON public.customers TO app_role;
GRANT UPDATE (display_name, phone_e164, email, human_only, deleted_at, updated_at) ON public.customers TO app_role;
GRANT SELECT, INSERT ON public.customer_identities TO app_role;
GRANT UPDATE (customer_id) ON public.conversations TO app_role;
GRANT SELECT (id, org_id, human_only, deleted_at, created_at, updated_at) ON public.customers TO support_role;
GRANT SELECT (id, org_id, customer_id, identity_type, channel_account_id, verification, created_at)
  ON public.customer_identities TO support_role;
GRANT SELECT (customer_id) ON public.conversations TO support_role;
