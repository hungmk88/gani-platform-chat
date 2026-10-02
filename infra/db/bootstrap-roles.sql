-- Cluster-level bootstrap: DB roles and database-level privileges (spec RLS M01 §3).
-- Run ONCE per database as a superuser. Idempotent: safe to run again (it also re-applies attributes).
-- Passwords come from the environment (never from this file):
--   APP_ROLE_PASSWORD, AUTH_ROLE_PASSWORD, MIGRATION_ROLE_PASSWORD
-- Example: psql -v ON_ERROR_STOP=1 -U postgres -d <db> -f infra/db/bootstrap-roles.sql
-- Not a migration: roles are cluster objects and migrations must never contain secrets.
\set ON_ERROR_STOP on
\getenv app_pw APP_ROLE_PASSWORD
\getenv auth_pw AUTH_ROLE_PASSWORD
\getenv migration_pw MIGRATION_ROLE_PASSWORD

-- Fail loud when a password is missing or empty (a variable that is not set would stay as literal text).
SELECT (:{?app_pw} AND :{?auth_pw} AND :{?migration_pw}) AS pw_set \gset
\if :pw_set
  SELECT (:'app_pw' <> '' AND :'auth_pw' <> '' AND :'migration_pw' <> '') AS pw_ok \gset
\else
  \set pw_ok false
\endif
\if :pw_ok
\else
  DO $$ BEGIN RAISE EXCEPTION 'bootstrap-roles: set non-empty APP_ROLE_PASSWORD, AUTH_ROLE_PASSWORD, MIGRATION_ROLE_PASSWORD'; END $$;
\endif

SELECT format('CREATE ROLE %I', t.rn) FROM unnest(ARRAY['app_role', 'auth_role', 'migration_role', 'support_role']) AS t(rn)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = t.rn) \gexec

ALTER ROLE app_role       WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'app_pw';
ALTER ROLE auth_role      WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'auth_pw';
-- migration_role: BYPASSRLS but NOT superuser. Used only by the migration pipeline.
ALTER ROLE migration_role WITH LOGIN NOSUPERUSER BYPASSRLS   NOCREATEDB NOCREATEROLE PASSWORD :'migration_pw';
-- support_role: no login. Each support person gets their own login `IN ROLE support_role` (later sprint).
ALTER ROLE support_role   WITH NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

-- Keep query text and bind parameters (invite tokens) out of the PostgreSQL log (spec §3.7).
-- Managed providers may not allow these settings: re-check when the cloud is chosen (QUESTIONS N51).
ALTER ROLE app_role  SET log_min_duration_statement = -1;
ALTER ROLE app_role  SET log_parameter_max_length = 0;
ALTER ROLE app_role  SET log_parameter_max_length_on_error = 0;
ALTER ROLE auth_role SET log_min_duration_statement = -1;
ALTER ROLE auth_role SET log_parameter_max_length = 0;
ALTER ROLE auth_role SET log_parameter_max_length_on_error = 0;

-- migration_role owns the public schema so it can create objects; nobody else can.
ALTER SCHEMA public OWNER TO migration_role;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database()) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO app_role, auth_role, support_role', current_database()) \gexec
SELECT format('GRANT CONNECT, CREATE ON DATABASE %I TO migration_role', current_database()) \gexec
