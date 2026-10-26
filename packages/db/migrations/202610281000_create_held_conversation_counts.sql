-- rollback: compensating migration drops function app.held_conversation_counts(uuid[]); the list of assignees then counts nothing (U31).
-- app.held_conversation_counts (U31, N168): how many conversations each person given holds, in every live workspace of the current
-- organisation. The limit of a person is for the whole organisation (agent_settings, U45), but row-level security keeps conversations to
-- the caller's own workspaces, so a Sales of workspace A would count nothing of a colleague's work in workspace B. So, as for
-- app.outbox_stats, a SECURITY DEFINER function owned by migration_role (BYPASSRLS) that hands back a person and a number and nothing
-- else: no conversation, no workspace, no content. The organisation is app.current_org(): a call without a tenant fails (TN001), and
-- people of another organisation count nothing. Held means assigned_user_id is set, which the table itself ties to HUMAN_ACTIVE and
-- PENDING_CUSTOMER (202610061100). A person who holds nothing has no row.

CREATE FUNCTION app.held_conversation_counts(p_user_ids uuid[])
  RETURNS TABLE (user_id uuid, held bigint)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
    SELECT c.assigned_user_id, count(*)
    FROM public.conversations c
    JOIN public.workspaces w ON w.org_id = c.org_id AND w.id = c.workspace_id AND w.deleted_at IS NULL
    WHERE c.org_id = app.current_org() AND c.assigned_user_id = ANY (p_user_ids)
    GROUP BY c.assigned_user_id
  $$;

REVOKE ALL ON FUNCTION app.held_conversation_counts(uuid[]) FROM PUBLIC;
-- Only the application role may run it: not auth_role, not support_role.
GRANT EXECUTE ON FUNCTION app.held_conversation_counts(uuid[]) TO app_role;
