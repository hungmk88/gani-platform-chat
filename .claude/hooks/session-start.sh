#!/bin/bash
# SessionStart hook (Mức 2.5, brief 2810-07112026-OPS-BRIEF-01, CEO duyệt 07/11/2026). Chạy khi phiên startup, resume (worker
# khởi động lại), clear, compact: nhắc AI kiểm việc dở trước khi trả lời. Git là nguồn sự thật qua container restart;
# .session/ chỉ ở máy của phiên, mất khi đổi máy. Áp cho mọi phiên (FE, BE): output tối đa 49 dòng, luôn exit 0, không in
# PII/secret (chỉ trạng thái git và file checkpoint do chính phiên ghi).
input=$(cat 2>/dev/null || true)
src=$(printf '%s' "$input" | sed -n 's/.*"source"[[:space:]]*:[[:space:]]*"\([a-z]*\)".*/\1/p')
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

report() {
  echo "=== CHECKPOINT PHIÊN (SessionStart: ${src:-không rõ}) ==="
  echo "Phiên vừa bắt đầu lại (worker restart / resume / compact). TRƯỚC khi trả lời: đọc lại lượt cuối của hội thoại; còn việc"
  echo "dở (nhánh chưa push, PR chờ CI/merge, báo cáo chưa gửi, check-in tới hạn) thì làm tiếp ngay. KHÔNG trả lời"
  echo "\"No response requested\" khi chưa kiểm xong. Không chắc trạng thái: trả lời \"Em cần kiểm lại trạng thái\" rồi kiểm."
  if git rev-parse --git-dir >/dev/null 2>&1; then
    echo "--- git branch --show-current ---"
    git branch --show-current 2>/dev/null
    echo "--- git status --short (tối đa 10 dòng) ---"
    st=$(git status --short 2>/dev/null)
    if [ -n "$st" ]; then
      printf '%s\n' "$st" | head -n 10
      n=$(printf '%s\n' "$st" | wc -l | tr -d ' ')
      [ "$n" -gt 10 ] && echo "... tổng $n file"
    else
      echo "(sạch)"
    fi
    echo "--- git log -3 --oneline ---"
    git log -3 --oneline --no-decorate 2>/dev/null
    echo "--- git rev-list --count @{u}..HEAD (commit chưa push) ---"
    git rev-list --count '@{u}..HEAD' 2>/dev/null || echo "(nhánh chưa có upstream: chưa push lần nào)"
  fi
  have=0
  for f in .session/CHECKPOINT_README.md .session/session-state.json; do
    if [ -f "$f" ] && [ ! -L "$f" ]; then
      have=1
      echo "--- $f (sửa lần cuối $(date -u -r "$f" '+%Y-%m-%d %H:%M UTC' 2>/dev/null)) ---"
      head -c 2000 "$f" | head -n 8
      echo
    fi
  done
  # Cache .session/ mất khi đổi máy; docs/ui/session-state.json nằm trong git nên là nguồn sự thật (CEO, brief 126).
  g=docs/ui/session-state.json
  if [ "$have" = 0 ] && [ -f "$g" ] && [ ! -L "$g" ]; then
    have=1
    echo "--- $g (nguồn sự thật, trong git; .session/ không còn) ---"
    head -c 2000 "$g" | head -n 8
    echo
  fi
  if [ "$have" = 0 ]; then
    echo ".session/ không còn (đổi máy). Đọc docs/ui/session-summary-29-10.md để biết việc dở. Kiểm git status trước khi trả lời."
  fi
}

report 2>/dev/null | head -n 49
exit 0
