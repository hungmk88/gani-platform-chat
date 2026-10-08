-- rollback: compensating migration drops function app.channel_account_for_webhook(uuid); the webhook then cannot find the organisation of a channel (N105).
-- app.channel_account_for_webhook: the first step of a webhook, which arrives with a channel account id and no tenant (zalo spec §3).
-- app_role is filtered by RLS and raises TN001 without a tenant, and no role of ours may bypass RLS, so this is a FUNCTION:
-- SECURITY DEFINER, it runs as its owner (migration_role, BYPASSRLS) and hands back only what the API needs to open a TenantTx and
-- check the signature. Same pattern as app.outbox_pending_orgs (N94) and app.memberships_for_user (N76); no fifth role.
-- Returns the two secrets as CIPHERTEXT: which one signs the webhook (the application or the OA) is still open (Z2). The
-- ciphertext is bound by its AAD to the channel account id and the column name, so it is of no use for another row or column. When Z2
-- is settled the function is narrowed by a migration. Never returns the access or refresh token, and not the id (the caller has it).
-- A deleted account or an account of a deleted organisation gives no row. A `disconnected` account still gives its row, with its
-- status, so the API can treat it as unknown to the caller and still tell it apart in its own log. An unknown or null id gives no row.

CREATE FUNCTION app.channel_account_for_webhook(p_id uuid)
  RETURNS TABLE (org_id uuid, workspace_id uuid, type text, status text, key_version integer, app_id text,
                 app_secret_enc bytea, oa_secret_key_enc bytea)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  SELECT c.org_id, c.workspace_id, c.type, c.status, c.key_version, c.app_id, c.app_secret_enc, c.oa_secret_key_enc
  FROM public.channel_accounts c
  JOIN public.organizations o ON o.id = c.org_id AND o.deleted_at IS NULL
  WHERE c.id = p_id AND c.deleted_at IS NULL
$$;

REVOKE ALL ON FUNCTION app.channel_account_for_webhook(uuid) FROM PUBLIC;
-- Only the application role (the API uses it): not auth_role, not support_role.
GRANT EXECUTE ON FUNCTION app.channel_account_for_webhook(uuid) TO app_role;
