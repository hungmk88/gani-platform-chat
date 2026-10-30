#!/usr/bin/env bash
# Whether the CI job `docker` must run (infra/CLAUDE.md "Docker"). A pull request that changes only files of the denylist skips it;
# everything else, push to main and runs by hand included, runs it. Writes `docker=true|false` to $GITHUB_OUTPUT (stdout when unset)
# and ALWAYS exits 0: whenever the answer is unclear (git fails, no merge commit, base differs) it is docker=true (fail-safe). The `if:`
# of `docker` in ci.yml is the second layer: it runs docker unless this answered exactly `false`.
# Env: EVENT_NAME (github.event_name), BASE_SHA (github.event.pull_request.base.sha). Run in the checkout of the merge commit of the
# pull request (refs/pull/N/merge, fetch-depth: 2): HEAD^1 is the base, HEAD^2 the head of the pull request.
# No -E: the ERR trap must not run inside $(...), where its exit would end only the subshell; a failing $(...) returns its code
# here and the trap of this shell answers.
set -euo pipefail
out="${GITHUB_OUTPUT:-/dev/stdout}"
decide() {
  echo "docker=$1" >>"$out"
  echo "docker-needed: docker=$1 ($2)"
  exit 0
}
trap 'decide true "không xác định được: lệnh lỗi ở dòng $LINENO, chạy docker"' ERR

# Files the images never read: Dockerfiles copy the whole repository (`COPY . .`), so this lists what may be skipped, never what
# must run. Reading a Markdown file or anything under docs/ at build or run time means changing this list.
DENY='(\.md$|^docs/|^prototype/|^evals/|^\.github/ISSUE_TEMPLATE/)'

# Before any git command: only a pull request may skip.
[ "${EVENT_NAME:-}" = pull_request ] || decide true "sự kiện '${EVENT_NAME:-}': luôn chạy"
[ -n "${BASE_SHA:-}" ] || decide true "thiếu base.sha, chạy docker"
base=$(git rev-parse --verify --quiet 'HEAD^1') || decide true "không có HEAD^1, chạy docker"
git rev-parse --verify --quiet 'HEAD^2' >/dev/null || decide true "HEAD không phải merge commit, chạy docker"
[ "$base" = "$BASE_SHA" ] || decide true "HEAD^1 ($base) khác base.sha ($BASE_SHA), chạy docker"

# --no-renames: a renamed file counts under its old name too (src/a.ts -> docs/a.md changes the build).
files=$(git diff --name-only --no-renames 'HEAD^1' HEAD)
[ -n "$files" ] || decide true "không có file đổi, chạy docker"
echo "docker-needed: file đổi so với base $base:"
printf '%s\n' "$files" | sed 's/^/  /'
others=$(printf '%s\n' "$files" | grep -v -E "$DENY" || true)
[ -n "$others" ] || decide false "chỉ docs: mọi file đổi khớp denylist"
decide true "có file ngoài denylist, ví dụ: $(printf '%s\n' "$others" | head -n 3 | tr '\n' ' ')"
