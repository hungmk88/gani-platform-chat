-- rollback: compensating migration drops function app.held_conversation_counts_by_state(uuid[]) and points listAssigneeCandidates back at app.held_conversation_counts.
-- app.held_conversation_counts_by_state (U31, N168, Brief §M04 dòng 718): what each person given holds, split by state, in every live
-- workspace of the current organisation. Brief §M04 counts only HUMAN_ACTIVE against max_concurrent_conversations; PENDING_CUSTOMER (the
-- agent answered, the customer has not) is shown apart. The function of 202610281000 counted both as one number, so the list of
-- assignees showed people as full too soon.
-- This function REPLACES app.held_conversation_counts. That one is kept, called by nothing any more, so that no DROP runs in this sprint
-- (expand → contract, packages/db/CLAUDE.md); a separate PR drops it once confirmed. It is not dead code left by mistake.
-- Each count names its state: a state added one day counts in neither until someone decides where it belongs (today the CHECK of
-- 202610061100 lets no other state have an assignee at all).
-- Same guard as 202610281000: SECURITY DEFINER owned by migration_role, an id and two numbers out, the organisation is app.current_org()
-- (a call without a tenant fails, TN001), deleted workspaces count nothing, only app_role may run it.

CREATE FUNCTION app.held_conversation_counts_by_state(p_user_ids uuid[])
  RETURNS TABLE (user_id uuid, active bigint, awaiting_customer bigint)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
    SELECT c.assigned_user_id,
      count(*) FILTER (WHERE c.state = 'HUMAN_ACTIVE'),
      count(*) FILTER (WHERE c.state = 'PENDING_CUSTOMER')
    FROM public.conversations c
    JOIN public.workspaces w ON w.org_id = c.org_id AND w.id = c.workspace_id AND w.deleted_at IS NULL
    WHERE c.org_id = app.current_org() AND c.assigned_user_id = ANY (p_user_ids)
    GROUP BY c.assigned_user_id
  $$;

REVOKE ALL ON FUNCTION app.held_conversation_counts_by_state(uuid[]) FROM PUBLIC;
-- Only the application role may run it: not auth_role, not support_role.
GRANT EXECUTE ON FUNCTION app.held_conversation_counts_by_state(uuid[]) TO app_role;
