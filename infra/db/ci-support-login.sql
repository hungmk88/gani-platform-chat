-- CI ONLY. Creates the throwaway login support_test_login so database tests can connect as a real support person
-- (app.support_access_ok() reads session_user, which SET ROLE cannot fake). Never run this against any other database:
-- real support logins are created per person by infra, never by this file. The password comes from the environment.
-- Run after bootstrap-roles.sql: psql -v ON_ERROR_STOP=1 -U postgres -d <db> -f infra/db/ci-support-login.sql
\set ON_ERROR_STOP on
\getenv support_pw SUPPORT_TEST_LOGIN_PASSWORD

SELECT (:{?support_pw} AND :'support_pw' <> '') AS pw_ok \gset
\if :pw_ok
\else
  DO $$ BEGIN RAISE EXCEPTION 'ci-support-login: set a non-empty SUPPORT_TEST_LOGIN_PASSWORD'; END $$;
\endif

SELECT format('CREATE ROLE support_test_login LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE IN ROLE support_role PASSWORD %L', :'support_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'support_test_login') \gexec
