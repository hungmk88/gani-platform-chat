-- rollback: compensating migration drops constraint conversations_org_workspace_id_key; only possible while no foreign key points at it (messages does, from 202610061010).
-- Target of the composite foreign key of messages (org_id, workspace_id, conversation_id): a message cannot name a workspace
-- other than the one of its conversation, so the O+W policy of messages and the one of conversations always agree. The table is
-- the frame of S1 and holds no real rows yet, so the lock this takes is harmless (N94).

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_org_workspace_id_key UNIQUE (org_id, workspace_id, id);
