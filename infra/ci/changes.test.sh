#!/usr/bin/env bash
# Tests of infra/ci/changes.sh, run by the CI job `changes` before the script itself. Each case builds a throwaway repository with a
# pull request merged like refs/pull/N/merge (main moved on after the branch, so the diff must ignore what main added), runs the
# script there and checks its four answers and its exit code (always 0). Usage: infra/ci/changes.test.sh
set -euo pipefail
script="$(cd "$(dirname "$0")" && pwd)/changes.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.test GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.test
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

# check <name> <docker backend admin terraform as "TFTF"> <command...>: runs the script through the command in the current directory.
# Cases run in subshells (each in its own repository), so a failure is a file, not a variable.
check() {
  local name=$1 want=$2 got code
  shift 2
  : >"$tmp/out"
  code=0
  GITHUB_OUTPUT="$tmp/out" "$@" >"$tmp/log" 2>&1 || code=$?
  got=""
  for job in docker backend admin terraform; do
    case "$(sed -n "s/^$job=//p" "$tmp/out")" in true) got+=T ;; false) got+=F ;; *) got+=? ;; esac
  done
  # Exactly four answers: more lines would mean the script went on after answering.
  if [ "$code" = 0 ] && [ "$got" = "$want" ] && [ "$(wc -l <"$tmp/out")" = 4 ]; then
    echo "ok   $name: $got"
  else
    echo "FAIL $name: want $want exit 0, got '$got' exit $code"
    sed 's/^/     /' "$tmp/log"
    touch "$tmp/failed"
  fi
}
run() { EVENT_NAME=pull_request BASE_SHA="$base" "$script"; }

# pr <commands...>: a repository whose HEAD is the merge commit of a branch that ran the commands; $base is main before the merge.
pr() {
  local dir
  dir=$(mktemp -d "$tmp/repo.XXXX")
  git init -q -b main "$dir" && cd "$dir"
  mkdir -p src docs && echo a >src/a.ts && echo r >README.md && git add -A && git commit -qm base
  git checkout -qb pr && eval "$*" && git add -A && git commit -qm change --allow-empty
  git checkout -q main && mkdir -p apps/admin && echo m >apps/admin/moved.ts && git add -A && git commit -qm "main moves on"
  base=$(git rev-parse HEAD)
  git merge -q --no-ff pr -m merge
}
# add <path...>: writes a line to each file, making its folders.
add() { for f in "$@"; do mkdir -p "$(dirname "$f")" && echo x >>"$f"; done; }

# A git in front of the real one: records every call when GIT_CALLS is set, fails `git diff` when FAIL_GIT_DIFF=1.
mkdir -p "$tmp/fakebin"
printf '%s\n' '#!/usr/bin/env bash' \
  '[ -z "${GIT_CALLS:-}" ] || echo "$*" >>"$GIT_CALLS"' \
  '[ "${FAIL_GIT_DIFF:-}" = 1 ] && [ "$1" = diff ] && { echo "fatal: simulated" >&2; exit 128; }' \
  'exec "$REAL_GIT" "$@"' >"$tmp/fakebin/git"
chmod +x "$tmp/fakebin/git"
fake=(env REAL_GIT="$(command -v git)" PATH="$tmp/fakebin:$PATH")

# The table of infra/CLAUDE.md, one kind of pull request per case (answers: docker, backend, admin, terraform).
(pr 'add QUESTIONS.md docs/a.md' && check "chỉ docs" FFFF run)
(pr 'add docs/openapi/openapi.json prototype/a.html evals/b.json .github/ISSUE_TEMPLATE/bug.yml' && check "docs/, prototype/, evals/, ISSUE_TEMPLATE" FFFF run)
(pr 'add apps/admin/CLAUDE.md docs/ui/a.md' && check "Markdown của admin" FFFF run)
(pr 'add apps/api/src/a.ts packages/db/src/b.ts' && check "chỉ backend" TTFF run)
(pr 'add apps/admin/src/a.tsx packages/ui/b.css' && check "chỉ admin" TFTF run)
(pr 'add apps/widget/src/a.ts' && check "chỉ widget" TFTF run)
(pr 'add infra/terraform/envs/staging/main.tf' && check "chỉ terraform" FFFT run)
(pr 'add apps/api/src/a.ts apps/admin/src/b.tsx' && check "lẫn backend + admin" TTTF run)
(pr 'add package.json pnpm-lock.yaml' && check "file ở gốc" TTTF run)
(pr 'add .github/workflows/ci.yml' && check "workflow" TTTT run)
(pr 'add infra/ci/x.sh' && check "infra/ci/" TTTT run)
(pr 'add infra/docker/Dockerfile.node' && check "Dockerfile" TTFF run)
(pr 'git mv src/a.ts docs/a.md' && check "đổi tên src/a.ts thành docs/a.md" TTFF run)
(pr ':' && check "không có file đổi" TTTT run)

# Never a pull request: everything runs, even on a change of Markdown only, and before calling git at all.
(pr 'add QUESTIONS.md' && check "push lên main" TTTT "${fake[@]}" GIT_CALLS="$tmp/git-calls" EVENT_NAME=push BASE_SHA="$base" "$script" &&
  if [ -e "$tmp/git-calls" ]; then echo "FAIL push lên main: git was called: $(cat "$tmp/git-calls")" && touch "$tmp/failed"; fi)
(pr 'add QUESTIONS.md' && check "chạy tay" TTTT env EVENT_NAME=workflow_dispatch BASE_SHA="$base" "$script")

# Fail-safe: whatever goes wrong, every answer is true and the exit is 0.
(pr 'add QUESTIONS.md' && check "git lỗi (GIT_DIR=/nonexistent)" TTTT env GIT_DIR=/nonexistent EVENT_NAME=pull_request BASE_SHA="$base" "$script")
(pr 'add QUESTIONS.md' && check "thiếu base.sha" TTTT env EVENT_NAME=pull_request BASE_SHA= "$script")
(git init -q -b main "$tmp/first" && cd "$tmp/first" && echo x >a.md && git add -A && git commit -qm first &&
  check "không có HEAD^1 (commit đầu tiên)" TTTT env EVENT_NAME=pull_request BASE_SHA=deadbeef "$script")
(pr 'add QUESTIONS.md' && check "HEAD^1 khác base.sha" TTTT env EVENT_NAME=pull_request BASE_SHA=deadbeef "$script")
# The head of the pull request alone (one parent), with BASE_SHA its parent: only the merge-commit check stops it.
(pr 'add QUESTIONS.md' && git reset -q --hard 'HEAD^2' &&
  check "HEAD không phải merge commit" TTTT env EVENT_NAME=pull_request BASE_SHA="$(git rev-parse 'HEAD^1')" "$script")
# git diff fails after every check passed: only the ERR trap can answer.
(pr 'add QUESTIONS.md' && check "git diff lỗi (trap)" TTTT "${fake[@]}" FAIL_GIT_DIFF=1 EVENT_NAME=pull_request BASE_SHA="$base" "$script")

if [ -e "$tmp/failed" ]; then
  echo "changes: CÓ CA ĐỎ"
  exit 1
fi
echo "changes: tất cả ca đạt"
