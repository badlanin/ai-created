#!/usr/bin/env bash
# 给 deploy.targets 里所有 VM 配置 GitHub 只读 PAT（一次性 / 偶尔轮换 PAT 时用）
#
# 用法：
#   bash scripts/setup-vm-credentials.sh
#
# 流程：
#   1. 在你本地 shell 里 read -s 读取 PAT（不回显）
#   2. 写到本地 mktemp 临时文件（仅当前用户可读，立刻 shred）
#   3. gcloud compute scp 把文件传到每台 VM 的 ~/.git-credentials（SSH 加密通道）
#   4. SSH 上去 chmod 600 + 配 credential.helper + 试一次 git fetch 验证
#
# 关键：PAT 永远不进任何 SSH 命令字符串、进程列表、shell history、git 历史。

set -euo pipefail

GITHUB_USER="ruchenlab-spec"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGETS_FILE="$REPO_ROOT/deploy.targets"

if [[ ! -f "$TARGETS_FILE" ]]; then
  echo "❌ 找不到 $TARGETS_FILE"
  exit 1
fi

echo "═══════════════════════════════════════════════════════════"
echo " 配置 VM GitHub 凭证（只读 PAT）"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  GitHub 用户名: $GITHUB_USER"
echo "  目标 VM:"
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%%#*}"; line="$(echo "$line" | xargs)"
  [[ -z "$line" ]] && continue
  read -r project zone instance dir <<< "$line"
  echo "    - $instance @ $project / $zone"
done < "$TARGETS_FILE"

echo ""
echo "粘贴只读 PAT（输入不显示，回车结束）。"
echo "PAT 应以 github_pat_ 开头，权限只 Contents:Read，仓库限定 buqiqi-ai-tool。"
echo ""
read -r -s -p "PAT: " GITHUB_PAT
echo
echo

if [[ -z "$GITHUB_PAT" ]]; then
  echo "❌ PAT 为空，已退出"
  exit 1
fi

if [[ ! "$GITHUB_PAT" =~ ^github_pat_ ]]; then
  echo "⚠️  PAT 不是 'github_pat_' 开头，可能格式不对"
  read -r -p "继续吗？(y/N): " yn
  [[ "$yn" != "y" && "$yn" != "Y" ]] && { echo "已取消"; exit 1; }
fi

# ─── 把 PAT 写到本地临时文件（umask 077 限权） ───
umask 077
TMP_CRED="$(mktemp -t git-cred-XXXXXX)"
trap 'shred -u "$TMP_CRED" 2>/dev/null || rm -f "$TMP_CRED"' EXIT
printf "https://%s:%s@github.com\n" "$GITHUB_USER" "$GITHUB_PAT" > "$TMP_CRED"
unset GITHUB_PAT  # 内存里的拷贝清掉，文件是唯一来源

echo "▶ 开始配置..."

TOTAL=0; OK=0; FAIL=0; FAILED=()

while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%%#*}"; line="$(echo "$line" | xargs)"
  [[ -z "$line" ]] && continue
  read -r project zone instance dir <<< "$line"
  TOTAL=$((TOTAL+1))

  echo ""
  echo "──[$TOTAL] $instance @ $project ──"

  # 1) SCP 把 PAT 文件加密传到 VM 的 ~/.git-credentials
  if ! gcloud compute scp "$TMP_CRED" "$instance:.git-credentials" \
        --project="$project" --zone="$zone" \
        --strict-host-key-checking=no --quiet \
        2>&1 | grep -vE "^(WARNING|Updating|Waiting|Updated|This tool|^\.\.)"; then
    FAIL=$((FAIL+1)); FAILED+=("$instance: scp failed")
    continue
  fi

  # 2) SSH 配 helper + 测 fetch（命令里没有 PAT）
  REMOTE='set -e
chmod 600 ~/.git-credentials
git config --global credential.helper store
echo "  ✓ ~/.git-credentials perms: $(stat -c %a ~/.git-credentials)"
echo "  ✓ credential.helper = $(git config --global credential.helper)"
if [ -d ~/buqiqi-ai-tool/.git ]; then
  cd ~/buqiqi-ai-tool
  if GIT_TERMINAL_PROMPT=0 git fetch origin --quiet 2>&1; then
    echo "  ✓ git fetch 成功 (origin/main HEAD: $(git rev-parse --short origin/main))"
  else
    echo "  ✗ git fetch 失败 —— PAT 或权限问题"
    exit 2
  fi
fi'

  if gcloud compute ssh "$instance" \
       --project="$project" --zone="$zone" \
       --strict-host-key-checking=no --quiet \
       --command="$REMOTE" \
       < /dev/null 2>&1 \
       | grep -vE "^(WARNING|Updating|Waiting|Updated|This tool|If you|The server|Store key|ssh-ed25519|^\.\.)"; then
    OK=$((OK+1))
    echo "  ✅ 配置完成"
  else
    FAIL=$((FAIL+1)); FAILED+=("$instance: ssh setup failed")
  fi
done < "$TARGETS_FILE"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  配置完成：$OK / $TOTAL"
if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "  失败:"
  for f in "${FAILED[@]}"; do echo "    - $f"; done
  exit 1
fi
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "下一步：bash scripts/deploy.sh --skip-push --only=<instance>"
