-- rollback: compensating migration drops table public.message_deliveries; agent messages then have no delivery state (N146).
-- message_deliveries: whether a message of the account reached the person on the channel (Brief P9 `message.status_changed`, N146).
-- One row per message sent to a channel, written `pending` in the transaction of the send (POST /v1/conversations/{id}/messages);
-- the outbound worker (8b, waiting for the Zalo send API, Z6) moves it to `sent` or `failed`. A separate table because messages is
-- append-only and partitioned: a status that changes does not belong there. No foreign key to messages: its key holds created_at
-- (partitions), so (org_id, message_id) is unique here instead. RLS by organisation AND workspace, like messages. No body, no
-- person: ids, a state, a count, an error code.

CREATE TABLE public.message_deliveries (
  id uuid NOT NULL,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  message_id uuid NOT NULL,
  channel_account_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  platform_message_id text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_deliveries_pkey PRIMARY KEY (id),
  CONSTRAINT message_deliveries_message_key UNIQUE (org_id, message_id),
  CONSTRAINT message_deliveries_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  -- The workspace must be the one of the conversation, and the channel account one of the same workspace.
  CONSTRAINT message_deliveries_conversation_fk FOREIGN KEY (org_id, workspace_id, conversation_id)
    REFERENCES public.conversations (org_id, workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT message_deliveries_channel_account_fk FOREIGN KEY (org_id, workspace_id, channel_account_id)
    REFERENCES public.channel_accounts (org_id, workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT message_deliveries_status_check CHECK (status IN ('pending', 'sent', 'failed')),
  CONSTRAINT message_deliveries_attempts_check CHECK (attempts >= 0),
  -- A code, never a message of the platform (F-03, N124).
  CONSTRAINT message_deliveries_last_error_check CHECK (last_error IS NULL OR last_error ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT message_deliveries_platform_message_id_check
    CHECK (platform_message_id IS NULL OR btrim(platform_message_id) <> ''),
  -- Sent means the platform answered: when, and with its id.
  CONSTRAINT message_deliveries_sent_check CHECK (
    (status = 'sent') = (sent_at IS NOT NULL) AND (status <> 'sent' OR platform_message_id IS NOT NULL)
  )
);

-- What a conversation shows next to its messages.
CREATE INDEX message_deliveries_conversation_idx ON public.message_deliveries (org_id, conversation_id);

ALTER TABLE public.message_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_deliveries FORCE ROW LEVEL SECURITY;

-- Same shape as messages_app (N75): the workspace test in USING and in WITH CHECK.
CREATE POLICY message_deliveries_app ON public.message_deliveries FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[]))
  WITH CHECK (org_id = (SELECT app.current_org())::uuid AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[]));

CREATE POLICY message_deliveries_support ON public.message_deliveries FOR SELECT TO support_role
  USING (
    org_id = (SELECT app.current_org())::uuid
    AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[])
    AND (SELECT app.support_access_ok())
  );

-- What the row is about never changes; only the outcome of the send does. No DELETE.
GRANT SELECT, INSERT ON public.message_deliveries TO app_role;
GRANT UPDATE (status, attempts, last_error, platform_message_id, sent_at, updated_at)
  ON public.message_deliveries TO app_role;
GRANT SELECT ON public.message_deliveries TO support_role;
