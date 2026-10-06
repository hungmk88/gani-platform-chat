-- rollback: compensating migration drops table public.messages and its partitions; only acceptable before real conversations exist (N94).
-- messages: what customers, agents, the bot and the system said in a conversation (Brief P8 M04). RLS by organisation AND workspace
-- (O+W, like conversations), partitioned by month, append-only for app_role: a message is never edited or deleted by the application.
-- sequence_number is allocated by the application inside the transaction of the INSERT (advisory lock + MAX+1, realtime spec §4), so
-- it cannot be UNIQUE here: a unique key on a partitioned table must contain the partition column (N94). Not a business column of
-- the standard set (updated_at, created_by): the table is immutable, and sender_user_id is its created_by. attachments wait for the
-- files table (M2). No foreign key on sender_user_id: the log outlives the account.

CREATE TABLE public.messages (
  id uuid NOT NULL,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  sequence_number bigint NOT NULL,
  sender_kind text NOT NULL,
  sender_user_id uuid,
  kind text NOT NULL,
  body text,
  platform_message_id text,
  platform_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_pkey PRIMARY KEY (id, created_at),
  CONSTRAINT messages_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  -- Org, workspace and conversation together: the workspace must be the one of the conversation.
  CONSTRAINT messages_conversation_fk FOREIGN KEY (org_id, workspace_id, conversation_id)
    REFERENCES public.conversations (org_id, workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT messages_sequence_check CHECK (sequence_number >= 1),
  CONSTRAINT messages_sender_kind_check CHECK (sender_kind IN ('customer', 'agent', 'bot', 'system')),
  CONSTRAINT messages_kind_check CHECK (kind IN ('text', 'image', 'file', 'sticker', 'postback', 'system')),
  CONSTRAINT messages_platform_message_id_check CHECK (platform_message_id IS NULL OR btrim(platform_message_id) <> '')
) PARTITION BY RANGE (created_at);

-- The index of Brief P8: reading a conversation in order, and resume (sequence_number > $last).
CREATE INDEX messages_conversation_sequence_idx ON public.messages (org_id, conversation_id, sequence_number);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages FORCE ROW LEVEL SECURITY;

-- Same shape as conversations_app (N75): the workspace test in USING and in WITH CHECK, with the ::uuid[] cast.
CREATE POLICY messages_app ON public.messages FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[]))
  WITH CHECK (org_id = (SELECT app.current_org())::uuid AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[]));

-- support_role reads the body too: the three locks are the access session, the org and the workspaces (N94).
CREATE POLICY messages_support ON public.messages FOR SELECT TO support_role
  USING (
    org_id = (SELECT app.current_org())::uuid
    AND workspace_id = ANY ((SELECT app.current_workspaces())::uuid[])
    AND (SELECT app.support_access_ok())
  );

-- No UPDATE, no DELETE: the policies above are copied onto every partition by app.create_log_partitions below.
GRANT SELECT, INSERT ON public.messages TO app_role;
GRANT SELECT ON public.messages TO support_role;

SELECT app.create_log_partitions('public.messages', 2);
