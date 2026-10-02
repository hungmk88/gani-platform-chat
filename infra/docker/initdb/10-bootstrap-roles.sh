#!/bin/sh
# Runs once, on first start of an empty data directory (docker-entrypoint-initdb.d).
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f /bootstrap/bootstrap-roles.sql
