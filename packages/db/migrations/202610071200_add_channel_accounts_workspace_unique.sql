-- rollback: compensating migration drops constraint channel_accounts_org_workspace_id_key; only possible while no foreign key points at it (inbound_events does, from 202610071210).
-- Target of the foreign key (org_id, workspace_id, channel_account_id) of inbound_events (and later of conversations): a row cannot name
-- a workspace other than the one of its channel account, so the rows of a channel always sit in the workspace that owns it. Same as
-- conversations_org_workspace_id_key for messages (202610061000). The table holds no real rows yet, so the lock this takes is harmless.

ALTER TABLE public.channel_accounts
  ADD CONSTRAINT channel_accounts_org_workspace_id_key UNIQUE (org_id, workspace_id, id);
