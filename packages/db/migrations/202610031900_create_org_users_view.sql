-- rollback: compensating migration drops view app.org_users; nothing depends on it yet (N76).
-- app.org_users: the only way app_role sees people (spec RLS M01 §3.3). users is global with no RLS, so app_role has no privilege on it:
-- a direct SELECT would show every tenant's people to every tenant. A view has no SECURITY DEFINER: it runs with the rights of its
-- owner, migration_role (BYPASSRLS), so the WHERE below is the ONLY wall between tenants. security_barrier keeps a caller's own
-- predicate from running before it. Every name is schema-qualified because a view has no SET search_path.
-- No email on purpose (spec §3.3). Only active people: not deleted, not pending, not suspended, user not deleted.

CREATE VIEW app.org_users WITH (security_barrier = true) AS
SELECT m.org_id, u.id AS user_id, u.display_name, u.locale, m.role, m.status
FROM public.org_members m
JOIN public.users u ON u.id = m.user_id
WHERE m.org_id = (SELECT app.current_org())::uuid
  AND m.deleted_at IS NULL
  AND m.status = 'active'
  AND u.deleted_at IS NULL;

GRANT SELECT ON app.org_users TO app_role;
