-- rollback: compensating migration drops view app.org_member_directory; nothing but the list of members reads it (N153).
-- app.org_member_directory: the screen of members (#19, /settings/members), Owner and Admin only (danh-sach-man-M11, Phụ lục B "Mời
-- thành viên, đổi vai trò"). Unlike app.org_users it holds the email (N12: "a view with the email, the role checked by the service"):
-- the API reads it only for an Owner or an Admin. Like app.org_users it runs as its owner, migration_role (BYPASSRLS), so the WHERE below
-- is the only wall between tenants, and security_barrier keeps a caller's predicate from running before it. Every name is
-- schema-qualified because a view has no SET search_path.
-- One row per member that is not deleted: active, suspended, or a pending invitation (no user yet: the email is the invited one). Never
-- the hash of an invitation's token. A member whose user is deleted is left out.

CREATE VIEW app.org_member_directory WITH (security_barrier = true) AS
SELECT m.id, m.org_id, m.user_id, COALESCE(u.email, m.invited_email) AS email, u.display_name, m.role, m.status,
  COALESCE(u.two_factor_enabled, false) AS two_factor_enabled, m.invite_expires_at, m.created_at
FROM public.org_members m
LEFT JOIN public.users u ON u.id = m.user_id
WHERE m.org_id = (SELECT app.current_org())::uuid
  AND m.deleted_at IS NULL
  AND (m.user_id IS NULL OR u.deleted_at IS NULL);

GRANT SELECT ON app.org_member_directory TO app_role;
