-- rollback: compensating migration re-creates app.org_member_directory as in 202610221100 (drop the view and create it without the last column; CREATE OR REPLACE cannot remove one).
-- The screen of members shows each agent's own limit of conversations (C9, N156): the column max_concurrent_conversations of
-- public.agent_settings for the member's person in this organisation, or NULL when nobody set one (the workspace's
-- default_max_concurrent applies, Brief §M04). Appended last, as CREATE OR REPLACE VIEW requires; the rest is 202610221100 unchanged.
-- The view runs as migration_role (BYPASSRLS): the join is on the member's own org_id, never on the person alone.

CREATE OR REPLACE VIEW app.org_member_directory WITH (security_barrier = true) AS
SELECT m.id, m.org_id, m.user_id, COALESCE(u.email, m.invited_email) AS email, u.display_name, m.role, m.status,
  COALESCE(u.two_factor_enabled, false) AS two_factor_enabled, m.invite_expires_at, m.created_at,
  a.max_concurrent_conversations
FROM public.org_members m
LEFT JOIN public.users u ON u.id = m.user_id
LEFT JOIN public.agent_settings a ON a.org_id = m.org_id AND a.user_id = m.user_id
WHERE m.org_id = (SELECT app.current_org())::uuid
  AND m.deleted_at IS NULL
  AND (m.user_id IS NULL OR u.deleted_at IS NULL);
