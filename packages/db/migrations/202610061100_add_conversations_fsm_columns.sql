-- rollback: compensating migration drops the indexes, the constraints and the five columns added here; only acceptable before real conversations exist (N96).
-- Expand step of the state machine (FSM spec §3, N96): the columns it owns and the invariants of the data. The table is the frame
-- of S1 and holds no real rows, so the constraints validate at once. state, version and its CHECK already exist (4d, N75).
-- assigned_user_id is set exactly when a person holds the conversation (HUMAN_ACTIVE, PENDING_CUSTOMER) and cleared when it goes
-- back to the queue, to the bot or is closed (F3). closed_at and outcome go together and are cleared when a conversation reopens.
-- outcome is the result a person (or the bot) records when closing: Brief P14 "bắt buộc kết quả" (F4).

ALTER TABLE public.conversations
  ADD COLUMN assigned_user_id uuid,
  ADD COLUMN after_hours_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN closed_at timestamptz,
  ADD COLUMN outcome text,
  ADD COLUMN last_message_at timestamptz,
  -- Composite key, like every foreign key between business tables: the person must belong to the organisation of the conversation.
  ADD CONSTRAINT conversations_assigned_fk FOREIGN KEY (org_id, assigned_user_id)
    REFERENCES public.org_members (org_id, user_id) ON DELETE RESTRICT,
  -- A conversation held for after hours is the bot's: the hold is a flag of BOT_ACTIVE only.
  ADD CONSTRAINT conversations_hold_check CHECK (NOT after_hours_hold OR state = 'BOT_ACTIVE'),
  ADD CONSTRAINT conversations_assigned_check CHECK (
    (state IN ('HUMAN_ACTIVE', 'PENDING_CUSTOMER')) = (assigned_user_id IS NOT NULL)
  ),
  ADD CONSTRAINT conversations_closed_check CHECK (
    (state = 'CLOSED') = (closed_at IS NOT NULL) AND (state = 'CLOSED') = (outcome IS NOT NULL)
  ),
  ADD CONSTRAINT conversations_outcome_check CHECK (
    outcome IS NULL OR outcome IN ('won', 'lost', 'resolved', 'resolved_by_bot')
  );

-- Brief P8 indexes. The inbox one extends conversations_org_workspace_state_idx (4d), which becomes redundant: it is dropped
-- by a later contract step, not here (expand, then contract).
CREATE INDEX conversations_inbox_idx ON public.conversations (org_id, workspace_id, state, last_message_at DESC);
CREATE INDEX conversations_assigned_idx ON public.conversations (org_id, assigned_user_id, state);
