#!/usr/bin/env bash
# Tests of infra/ci/docker-needed.sh, run by the CI job `changes` before the script itself. Each case builds a throwaway repository
# with a pull request merged like refs/pull/N/merge (main moved on after the branch, so the diff must ignore what main added), runs
# the script there and checks its answer and its exit code (always 0). Usage: infra/ci/docker-needed.test.sh
set -euo pipefail
script="$(cd "$(dirname "$0")" && pwd)/docker-needed.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.test GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.test
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

# check <name> <expected true|false> <command...>: runs the script through the command in the current directory. Cases run in
# subshells (each in its own repository), so a failure is a file, not a variable.
check() {
  local name=$1 want=$2 got code
  shift 2
  : >"$tmp/out"
  code=0
  GITHUB_OUTPUT="$tmp/out" "$@" >"$tmp/log" 2>&1 || code=$?
  got=$(sed -n 's/^docker=//p' "$tmp/out")
  # Exactly one answer: a second line would mean the script went on after answering.
  if [ "$code" = 0 ] && [ "$got" = "$want" ] && [ "$(wc -l <"$tmp/out")" = 1 ]; then
    echo "ok   $name: docker=$got"
  else
    echo "FAIL $name: want docker=$want exit 0, got docker='$got' exit $code"
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
  git checkout -q main && echo m >main-moved-on.ts && git add -A && git commit -qm "main moves on"
  base=$(git rev-parse HEAD)
  git merge -q --no-ff pr -m merge
}

# A git in front of the real one: records every call when GIT_CALLS is set, fails `git diff` when FAIL_GIT_DIFF=1.
mkdir -p "$tmp/fakebin"
printf '%s\n' '#!/usr/bin/env bash' \
  '[ -z "${GIT_CALLS:-}" ] || echo "$*" >>"$GIT_CALLS"' \
  '[ "${FAIL_GIT_DIFF:-}" = 1 ] && [ "$1" = diff ] && { echo "fatal: simulated" >&2; exit 128; }' \
  'exec "$REAL_GIT" "$@"' >"$tmp/fakebin/git"
chmod +x "$tmp/fakebin/git"
fake=(env REAL_GIT="$(command -v git)" PATH="$tmp/fakebin:$PATH")

(pr 'echo x >QUESTIONS.md' && check "QUESTIONS.md ở gốc" false run)
(pr 'mkdir -p apps/api && echo x >apps/api/CLAUDE.md' && check "CLAUDE.md trong apps/" false run)
# A sub-case of docs/**: the only file under docs/ that is not Markdown; the images never read it.
(pr 'mkdir -p docs/openapi && echo {} >docs/openapi/openapi.json' && check "docs/openapi/openapi.json" false run)
(pr 'mkdir -p prototype evals .github/ISSUE_TEMPLATE && echo x >prototype/a.html && echo x >evals/b.json && echo x >.github/ISSUE_TEMPLATE/bug.yml' &&
  check "prototype/, evals/, ISSUE_TEMPLATE" false run)
(pr 'echo x >>README.md; echo b >src/b.ts' && check ".md + mã" true run)
(pr 'mkdir -p infra/docker && echo x >infra/docker/Dockerfile.node' && check "Dockerfile" true run)
(pr 'echo x >.dockerignore' && check ".dockerignore" true run)
(pr 'echo x >pnpm-lock.yaml' && check "pnpm-lock.yaml" true run)
(pr 'git mv src/a.ts docs/a.md' && check "đổi tên src/a.ts thành docs/a.md" true run)
(pr ':' && check "không có file đổi" true run)

# Never a pull request: always runs, even on a change of Markdown only, and before calling git at all.
(pr 'echo x >QUESTIONS.md' && check "push lên main" true "${fake[@]}" GIT_CALLS="$tmp/git-calls" EVENT_NAME=push BASE_SHA="$base" "$script" &&
  if [ -e "$tmp/git-calls" ]; then echo "FAIL push lên main: git was called: $(cat "$tmp/git-calls")" && touch "$tmp/failed"; fi)
(pr 'echo x >QUESTIONS.md' && check "chạy tay" true env EVENT_NAME=workflow_dispatch BASE_SHA="$base" "$script")

# Fail-safe: whatever goes wrong, docker=true and exit 0.
(pr 'echo x >QUESTIONS.md' && check "git lỗi (GIT_DIR=/nonexistent)" true env GIT_DIR=/nonexistent EVENT_NAME=pull_request BASE_SHA="$base" "$script")
(git init -q -b main "$tmp/first" && cd "$tmp/first" && echo x >a.md && git add -A && git commit -qm first &&
  check "không có HEAD^1 (commit đầu tiên)" true env EVENT_NAME=pull_request BASE_SHA=deadbeef "$script")
(pr 'echo x >QUESTIONS.md' && check "HEAD^1 khác base.sha" true env EVENT_NAME=pull_request BASE_SHA=deadbeef "$script")
# The head of the pull request alone (one parent), with BASE_SHA its parent: only the merge-commit check stops it.
(pr 'echo x >QUESTIONS.md' && git reset -q --hard 'HEAD^2' &&
  check "HEAD không phải merge commit" true env EVENT_NAME=pull_request BASE_SHA="$(git rev-parse 'HEAD^1')" "$script")
# git diff fails after every check passed: only the ERR trap can answer.
(pr 'echo x >QUESTIONS.md' && check "git diff lỗi (trap)" true "${fake[@]}" FAIL_GIT_DIFF=1 EVENT_NAME=pull_request BASE_SHA="$base" "$script")

if [ -e "$tmp/failed" ]; then
  echo "docker-needed: CÓ CA ĐỎ"
  exit 1
fi
echo "docker-needed: tất cả ca đạt"
