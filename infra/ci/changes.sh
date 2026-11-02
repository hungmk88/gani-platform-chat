#!/usr/bin/env bash
# Which CI jobs a change needs (infra/CLAUDE.md "Lọc đường dẫn", CEO 02/11/2026 Cách 1). Writes four answers to $GITHUB_OUTPUT (stdout
# when unset), each `true|false`, and ALWAYS exits 0:
#   docker    the job `docker`: false when every file is one the images never read (denylist DOCKER_SKIP);
#   backend   the jobs `db` and `queue` (and so `coverage`, which needs both): false when every file is docs, the admin, the widget,
#             packages/ui or Terraform (BACKEND_SKIP): the db job also runs the API's integration tests, queue the worker and the API;
#   admin     the job `admin-e2e`: true when a file that is not Markdown is under ADMIN_NEEDS (the admin, the widget, their packages,
#             a file at the root, the workflows);
#   terraform the job `terraform`: true when a file is under TERRAFORM_NEEDS.
# Whenever the answer is unclear (not a pull request, git fails, no merge commit, base differs) every answer is true (fail-safe). The
# `if:` of each job in ci.yml is the second layer: it runs unless its answer is exactly `false`.
# Env: EVENT_NAME (github.event_name), BASE_SHA (github.event.pull_request.base.sha). Run in the checkout of the merge commit of the
# pull request (refs/pull/N/merge, fetch-depth: 2): HEAD^1 is the base, HEAD^2 the head of the pull request.
# No -E: the ERR trap must not run inside $(...), where its exit would end only the subshell; a failing $(...) returns its code
# here and the trap of this shell answers.
set -euo pipefail
out="${GITHUB_OUTPUT:-/dev/stdout}"
all_true() {
  printf '%s\n' docker=true backend=true admin=true terraform=true >>"$out"
  echo "changes: docker=true backend=true admin=true terraform=true ($1)"
  exit 0
}
trap 'all_true "không xác định được: lệnh lỗi ở dòng $LINENO, chạy mọi job"' ERR

# Files the images never read: Dockerfiles copy the whole repository (`COPY . .`), so this lists what may be skipped, never what
# must run. Reading a Markdown file, anything under docs/ or infra/terraform/ at build or run time means changing this list.
DOCKER_SKIP='(\.md$|^docs/|^prototype/|^evals/|^\.github/ISSUE_TEMPLATE/|^infra/terraform/)'
BACKEND_SKIP='(\.md$|^docs/|^prototype/|^evals/|^\.github/ISSUE_TEMPLATE/|^infra/terraform/|^apps/admin/|^apps/widget/|^packages/ui/)'
ADMIN_NEEDS='(^apps/admin/|^apps/widget/|^packages/ui/|^packages/config/|^docs/ui/|^[^/]+$|^\.github/workflows/|^infra/ci/)'
TERRAFORM_NEEDS='(^infra/terraform/|^\.github/workflows/|^infra/ci/)'

# Before any git command: only a pull request may skip.
[ "${EVENT_NAME:-}" = pull_request ] || all_true "sự kiện '${EVENT_NAME:-}': luôn chạy"
[ -n "${BASE_SHA:-}" ] || all_true "thiếu base.sha"
base=$(git rev-parse --verify --quiet 'HEAD^1') || all_true "không có HEAD^1"
git rev-parse --verify --quiet 'HEAD^2' >/dev/null || all_true "HEAD không phải merge commit"
[ "$base" = "$BASE_SHA" ] || all_true "HEAD^1 ($base) khác base.sha ($BASE_SHA)"

# --no-renames: a renamed file counts under its old name too (src/a.ts -> docs/a.md changes the build).
files=$(git diff --name-only --no-renames 'HEAD^1' HEAD)
[ -n "$files" ] || all_true "không có file đổi"
echo "changes: file đổi so với base $base:"
printf '%s\n' "$files" | sed 's/^/  /'

# answer <name> <files that make it true>: true with the first of them as the reason, false when there is none.
lines=()
answer() {
  if [ -n "$2" ]; then
    lines+=("$1=true")
    echo "changes: $1=true, ví dụ $(printf '%s\n' "$2" | head -n 1)"
  else
    lines+=("$1=false")
    echo "changes: $1=false, không file nào cần"
  fi
}
answer docker "$(printf '%s\n' "$files" | grep -v -E "$DOCKER_SKIP" || true)"
answer backend "$(printf '%s\n' "$files" | grep -v -E "$BACKEND_SKIP" || true)"
answer admin "$(printf '%s\n' "$files" | grep -v -E '\.md$' | grep -E "$ADMIN_NEEDS" || true)"
answer terraform "$(printf '%s\n' "$files" | grep -E "$TERRAFORM_NEEDS" || true)"
printf '%s\n' "${lines[@]}" >>"$out"
