-- rollback: compensating migration drops the unique index conversations_open_per_user_key, the two constraints and the three columns added here; only acceptable before a conversation of a channel exists (N105).
-- Expand step of the channel conversations (inbound spec §3, I2, N105): which channel account and which person of that channel a
-- conversation belongs to. The three columns are nullable and have no default, so the conversations of M1.2 stay as they are and the
-- change rewrites nothing. window_state is NOT a column: it is computed when read or sent (C1-C6).
-- last_customer_message_at is the time of the last message of the CUSTOMER (the start of the free window); null until the first one.
-- This migration only adds the column; MessageService writes it later. The FSM guard does not watch it.

ALTER TABLE public.conversations
  ADD COLUMN channel_account_id uuid,
  ADD COLUMN external_user_id text,
  ADD COLUMN last_customer_message_at timestamptz,
  -- The account must be of the organisation AND of the workspace of the conversation. MATCH SIMPLE: not tested while it is null.
  ADD CONSTRAINT conversations_channel_account_fk FOREIGN KEY (org_id, workspace_id, channel_account_id)
    REFERENCES public.channel_accounts (org_id, workspace_id, id) ON DELETE RESTRICT,
  -- A conversation of a channel has both the account and the person; one without a channel has neither.
  ADD CONSTRAINT conversations_channel_check CHECK (
    (channel_account_id IS NULL) = (external_user_id IS NULL)
    AND (external_user_id IS NULL OR btrim(external_user_id) <> '')
  );

-- I2: one person has at most one conversation not closed on a channel account. Partial: closed ones do not count, and the
-- conversations without a channel (null) are not limited. Reopening a closed conversation (T14) while another one of the same
-- pair is open fails with 23505 on purpose: the processor looks for the open one first.
CREATE UNIQUE INDEX conversations_open_per_user_key
  ON public.conversations (channel_account_id, external_user_id)
  WHERE channel_account_id IS NOT NULL AND state <> 'CLOSED';
