-- rollback: compensating migration drops the columns last_message_preview and last_message_kind of public.conversations; the Inbox then shows no preview (U30).
-- The line of the Inbox under a conversation (U30, N169): what its last message said, written by insertMessage in the transaction that
-- already moves last_message_at, so the list reads it from the row instead of probing every monthly partition of messages for the last
-- message (measured 27/10: the probe grows with the number of months kept). Expand only: two nullable columns, no default, no rewrite;
-- rows written before are filled by a separate backfill (PR 1b), never here, so this takes no long lock.
-- last_message_kind is the kind of the last message that is not an event of the system; last_message_preview is only its text when it
-- is text (NFC, at most 120 graphemes, cut in the application). Another kind shows a label chosen when read, so no label is stored.
-- The text is PII of the customer: support_role reads conversations by a list of columns (202610201300) and gets neither column.

ALTER TABLE public.conversations
  ADD COLUMN last_message_preview text,
  ADD COLUMN last_message_kind text,
  ADD CONSTRAINT conversations_last_message_kind_check
    CHECK (last_message_kind IS NULL OR last_message_kind IN ('text', 'image', 'file', 'sticker', 'postback')),
  ADD CONSTRAINT conversations_last_message_preview_check
    CHECK (last_message_preview IS NULL OR last_message_kind = 'text');

-- app_role updates conversations by a list of columns (202610201300): insertMessage writes these two in its UPDATE.
GRANT UPDATE (last_message_preview, last_message_kind) ON public.conversations TO app_role;
