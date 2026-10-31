#!/usr/bin/env bash
# Kiểm PostgreSQL ở máy trước test tích hợp DB (CEO 31/10). VM có thể restart bất cứ lúc nào và PostgreSQL không tự bật: test DB
# khi đó lỗi kết nối, hoặc chạy trên DB chưa migrate mà vẫn xanh. Chỉ chạy ở local; CI bỏ qua vì job `database` đã có PostgreSQL
# qua docker. Cụm mặc định 16/main (`PG_CLUSTER_VERSION`, `PG_CLUSTER_NAME` để đổi); DB là của `DATABASE_URL_MIGRATION`, như test.
if [ "${CI:-}" = "true" ]; then exit 0; fi
set -euo pipefail

version="${PG_CLUSTER_VERSION:-16}"
cluster="${PG_CLUSTER_NAME:-main}"
fail() {
  echo "check-db: $*" >&2
  exit 1
}

command -v pg_lsclusters > /dev/null ||
  fail "không có pg_lsclusters (postgresql-common): máy này chạy PostgreSQL cách khác (docker compose: pnpm dev:infra), bật DB rồi chạy lại."
state="$(pg_lsclusters --no-header | awk -v v="$version" -v c="$cluster" '$1 == v && $2 == c { print $4 }')"
[ -n "$state" ] || fail "không có cụm PostgreSQL $version/$cluster (pg_lsclusters)."
if [ "$state" != online ]; then
  echo "check-db: cụm $version/$cluster đang $state, bật lại." >&2
  pg_ctlcluster "$version" "$cluster" start || fail "không bật được cụm $version/$cluster."
fi
[ -n "${DATABASE_URL_MIGRATION:-}" ] || fail "DATABASE_URL_MIGRATION chưa đặt: test tích hợp cần DB (xem README)."
policies="$(psql "$DATABASE_URL_MIGRATION" -tAc 'select count(*) from pg_policies')" ||
  fail "không đọc được DB của DATABASE_URL_MIGRATION."
[ "$policies" -gt 0 ] ||
  fail "DB chưa có policy RLS nào (pg_policies = 0): chưa migrate, test sẽ chạy trên DB rỗng. Chạy migrate rồi chạy lại."
echo "check-db: cụm $version/$cluster online, $policies policy RLS."
