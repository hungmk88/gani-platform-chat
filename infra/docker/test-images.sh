#!/usr/bin/env bash
# Checks of the four images (infra/CLAUDE.md "Docker"), run by the CI job `docker` after the build. Runs on any machine with the
# images built as gani-<name>:<tag>, PostgreSQL migrated-or-empty and Valkey on 127.0.0.1, and the variables of .env.example
# (DATABASE_URL_APP, DATABASE_URL_AUTH, DATABASE_URL_MIGRATION, REDIS_URL). Usage: infra/docker/test-images.sh <tag>
set -euo pipefail
tag="$1"
fail=0
problem() { echo "::error title=$1::$2"; fail=1; }
ms() { echo $(($(date +%s%N) / 1000000)); }
wait_http() { for _ in $(seq 1 40); do curl -sf -o /dev/null "$1" && return 0; sleep 1; done; return 1; }

# --- Size. Compressed is what every deploy pushes and pulls: over 150 MB fails, over 100 MB warns. Uncompressed only warns (400 MB,
# 600 MB): node:22-slim alone is about 326 MB. If an image grows, read its layers below; the usual causes are devDependencies in
# the runtime, files copied that the process does not need, or large native modules.
for name in api worker admin migrate; do
  ref="gani-$name:$tag"
  raw=$(($(docker image inspect "$ref" --format '{{.Size}}') / 1000000))
  gz=$(($(docker save "$ref" | gzip -1 | wc -c) / 1000000))
  echo "$ref: compressed ${gz} MB, uncompressed ${raw} MB"
  docker history --no-trunc --format '  {{.Size}}  {{.CreatedBy}}' "$ref" | cut -c1-200
  if ((gz > 150)); then problem "Image size" "$ref is ${gz} MB compressed (limit 150 MB)"
  elif ((gz > 100)); then echo "::warning title=Image size::$ref is ${gz} MB compressed (investigate above 100 MB)"; fi
  if ((raw > 600)); then echo "::warning title=Image size::$ref is ${raw} MB uncompressed (over 600 MB: shrink it soon)"
  elif ((raw > 400)); then echo "::warning title=Image size::$ref is ${raw} MB uncompressed (investigate above 400 MB)"; fi
  # Never root, and no source or tests of ours in the image (only dist, node_modules, package.json; migrate: SQL and scripts).
  [ "$(docker run --rm --entrypoint id "$ref" -u)" = 1000 ] || problem "User" "$ref does not run as uid 1000"
  extra=$(docker run --rm --entrypoint sh "$ref" -c 'find /app -path "*/node_modules" -prune -o \( -name src -o -name "*.test.*" -o -name "*.spec.*" \) -print')
  [ -z "$extra" ] || problem "Contents" "$ref holds source or tests: $extra"
done

# --- Missing configuration stops the process with a message, it never starts silently (DATABASE_URL_APP alone is optional on
# purpose: /readyz answers 503 without it, apps/api/CLAUDE.md).
secret=$(openssl rand -hex 32)
auth=(-e BETTER_AUTH_SECRET="$secret" -e BETTER_AUTH_URL=https://admin.example.test)
timeout 60 docker run --rm "${auth[@]}" "gani-api:$tag" >/dev/null 2>&1 && problem "Fail fast" "api started without DATABASE_URL_AUTH"
timeout 60 docker run --rm "gani-worker:$tag" >/dev/null 2>&1 && problem "Fail fast" "worker started without DATABASE_URL_APP"
timeout 60 docker run --rm "gani-migrate:$tag" >/dev/null 2>&1 && problem "Fail fast" "migrate ran without DATABASE_URL_MIGRATION"

# --- The migration job: applies every migration and exits 0.
docker run --rm --network host -e DATABASE_URL_MIGRATION "gani-migrate:$tag" || problem "Migrate" "gani-migrate failed"

# Starts a service on the host network, checks its probe and the HEALTHCHECK of the image, then `docker stop` must end it within 10 s.
service() {
  local name=$1 url=$2 codes=$3
  shift 3
  docker run -d --name "t-$name" --network host "$@" "gani-$name:$tag" >/dev/null
  if wait_http "$url"; then
    mapfile -t check < <(docker inspect --format '{{range slice .Config.Healthcheck.Test 1}}{{println .}}{{end}}' "gani-$name:$tag")
    docker exec "t-$name" "${check[@]}" || problem "Healthcheck" "the HEALTHCHECK of gani-$name fails"
    [ "$name" != api ] || api_checks
  else
    problem "Start" "gani-$name did not answer $url"
    docker logs "t-$name" 2>&1 | tail -n 30
  fi
  local t0
  t0=$(ms)
  docker stop -t 10 "t-$name" >/dev/null
  local took=$(($(ms) - t0)) code
  code=$(docker inspect --format '{{.State.ExitCode}}' "t-$name")
  echo "gani-$name: docker stop took ${took} ms, exit code ${code}"
  ((took < 10000)) || problem "Stop" "gani-$name needed ${took} ms to stop"
  [[ " $codes " == *" $code "* ]] || problem "Stop" "gani-$name exited with ${code}"
  docker rm "t-$name" >/dev/null
}
# The API with PostgreSQL and Valkey: /readyz checks both pools and Valkey; a Socket.IO client (WebSocket of Node, run inside the
# container) must get the `connect_error` of a client without a session from /agent, which goes through @socket.io/redis-adapter.
api_checks() {
  [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/readyz)" = 200 ] || problem "Ready" "api /readyz is not 200"
  docker exec t-api node -e "
    const ws = new WebSocket('ws://127.0.0.1:3000/socket.io/?EIO=4&transport=websocket');
    ws.onmessage = (m) => { const d = String(m.data);
      if (d.startsWith('0')) ws.send('40/agent,');
      if (d.startsWith('44/agent,')) { console.log('socket.io:', d); process.exit(0); } };
    setTimeout(() => process.exit(1), 10000);" || problem "Socket.IO" "no connect_error from /agent"
}
service api http://127.0.0.1:3000/healthz 0 -e DATABASE_URL_APP -e DATABASE_URL_AUTH -e REDIS_URL "${auth[@]}"
service worker http://127.0.0.1:9464/healthz 0 -e DATABASE_URL_APP -e REDIS_URL
# Next.js does not trap SIGTERM: 143 (killed by the signal) is its normal end.
service admin http://127.0.0.1:3001/login "0 143"

# --- Vulnerabilities (Trivy, pinned by digest). A CRITICAL with a fix available fails; every HIGH is printed.
# TRIVY_IMAGE and TRIVY_DOCKER_ARGS (extra `docker run` options, e.g. a proxy) only for a machine that cannot reach Docker Hub.
trivy=${TRIVY_IMAGE:-aquasec/trivy:0.58.1@sha256:ab70a02200597efa04748f210f793936eb647cbcdb0ea69cc30b226d6f5a22c7}
read -r -a trivy_args <<<"${TRIVY_DOCKER_ARGS:-}"
for name in api worker admin migrate; do
  scan=(docker run --rm "${trivy_args[@]}" -v /var/run/docker.sock:/var/run/docker.sock -v trivy-cache:/root/.cache "$trivy" image --scanners vuln
    --ignore-unfixed --no-progress --quiet)
  "${scan[@]}" --severity HIGH,CRITICAL "gani-$name:$tag" || true
  "${scan[@]}" --severity CRITICAL --exit-code 1 "gani-$name:$tag" >/dev/null || problem "Trivy" "gani-$name has a CRITICAL with a fix"
done

exit "$fail"
