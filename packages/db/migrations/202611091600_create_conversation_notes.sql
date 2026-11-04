-- rollback: compensating migration drops table public.conversation_notes; only acceptable before any note is written.
-- conversation_notes: the internal notes of a conversation (C6, N194, N135/U54; A 04/11/2026). The agents' free words, never shown to
-- the customer and never sent to a channel. RLS by who sees the conversation, like conversation_events and bot_sessions: the policies
-- ask app.conversation_visible, which reads conversations as the caller, so the O+W policy of conversations decides (a person of
-- workspace A never reads a note of B). kind: a note written as such, or the reason of a transfer written in the same transaction as
-- the transfer (N135). A note never changes and is never deleted in Đợt 1 (N194 (1d); spec RLS M01 §7 case 11): app_role may only
-- INSERT and SELECT. body may name the customer: support_role never reads it (as tickets.title, conversations.last_message_preview).

CREATE TABLE public.conversation_notes (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'note',
  author_user_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_notes_org_id_key UNIQUE (org_id, id),
  CONSTRAINT conversation_notes_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations (id) ON DELETE RESTRICT,
  CONSTRAINT conversation_notes_conversation_fk FOREIGN KEY (org_id, conversation_id)
    REFERENCES public.conversations (org_id, id) ON DELETE RESTRICT,
  -- A member of the organisation; that they may write a note on this conversation is the store's check (N194 (2)).
  CONSTRAINT conversation_notes_author_fk FOREIGN KEY (org_id, author_user_id)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT conversation_notes_kind_check CHECK (kind IN ('note', 'transfer_reason')),
  -- 1 to 2000 characters, 500 for the reason of a transfer; never blank; NFC like every text that is read back (N194 (1a)).
  CONSTRAINT conversation_notes_body_check CHECK (
    btrim(body) <> ''
    AND char_length(body) <= CASE kind WHEN 'transfer_reason' THEN 500 ELSE 2000 END
    AND body = normalize(body, NFC)
  )
);

-- The notes of a conversation, newest first (UUIDv7 ids follow time): the page and its cursor of GET .../notes.
CREATE INDEX conversation_notes_conversation_idx ON public.conversation_notes (org_id, conversation_id, id DESC);

ALTER TABLE public.conversation_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_notes FORCE ROW LEVEL SECURITY;

-- USING and WITH CHECK both carry the visibility test: nobody reads or writes a note of a conversation they cannot see.
CREATE POLICY conversation_notes_app ON public.conversation_notes FOR ALL TO app_role
  USING (org_id = (SELECT app.current_org())::uuid AND app.conversation_visible(org_id, conversation_id))
  WITH CHECK (org_id = (SELECT app.current_org())::uuid AND app.conversation_visible(org_id, conversation_id));
CREATE POLICY conversation_notes_support ON public.conversation_notes FOR SELECT TO support_role
  USING (
    org_id = (SELECT app.current_org())::uuid
    AND app.conversation_visible(org_id, conversation_id)
    AND (SELECT app.support_access_ok())
  );

-- Append only: no UPDATE, no DELETE. support_role reads every column but body.
GRANT SELECT, INSERT ON public.conversation_notes TO app_role;
GRANT SELECT (id, org_id, conversation_id, kind, author_user_id, created_at) ON public.conversation_notes TO support_role;
