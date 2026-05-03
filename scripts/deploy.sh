#!/usr/bin/env bash
# 一键部署：本地备份 → push 到 GitHub → SSH 三台 VM pull + 重建 Docker
#
# 用法：
#   bash scripts/deploy.sh                 # 备份 + push + 部署 deploy.targets 里全部
#   bash scripts/deploy.sh --skip-push     # 跳过 push（VM 直接拉当前 origin/main）
#   bash scripts/deploy.sh --no-backup     # 不备份（不推荐）
#   bash scripts/deploy.sh --only=1-sg     # 只部署 instance 名包含 '1-sg' 的
#   bash scripts/deploy.sh --dry-run       # 只打印命令不执行
#   bash scripts/deploy.sh --help

set -euo pipefail

# ─── 解析参数 ───
ONLY=""
DRY_RUN=false
DO_BACKUP=true
DO_PUSH=true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --only=*)    ONLY="${1#*=}"; shift ;;
    --only)      ONLY="$2"; shift 2 ;;
    --dry-run)   DRY_RUN=true; shift ;;
    --no-backup) DO_BACKUP=false; shift ;;
    --skip-push) DO_PUSH=false; shift ;;
    -h|--help)
      sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "❌ 未知参数: $1" >&2; exit 2 ;;
  esac
done

# ─── 路径计算 ───
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUPS_DIR="$(cd "$REPO_ROOT/.." && pwd)/backups"
TARGETS_FILE="$REPO_ROOT/deploy.targets"

if [[ ! -f "$TARGETS_FILE" ]]; then
  echo "❌ 找不到 $TARGETS_FILE"
  echo "   请复制 scripts/deploy.targets.example → deploy.targets 并填入 VM 信息"
  exit 1
fi

cd "$REPO_ROOT"

# ─── 1. 本地备份 ───
if $DO_BACKUP; then
  mkdir -p "$BACKUPS_DIR"
  STAMP=$(date +%Y-%m-%d_%H%M%S)
  HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "no-commit")
  BACKUP_FILE="$BACKUPS_DIR/${STAMP}_pre-deploy_${HASH}.tar.gz"
  echo "▶ 1/3 本地备份 → $BACKUP_FILE"
  if ! $DRY_RUN; then
    tar --exclude='node_modules' \
        --exclude='.next' \
        --exclude='data' \
        --exclude='backups' \
        --exclude='gcp-credentials' \
        -czf "$BACKUP_FILE" \
        -C "$(dirname "$REPO_ROOT")" "$(basename "$REPO_ROOT")" 2>/dev/null
    # 保留最近 20 份，更老的删掉
    ls -t "$BACKUPS_DIR"/*.tar.gz 2>/dev/null | tail -n +21 | xargs -r rm -f
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    KEPT=$(ls "$BACKUPS_DIR"/*.tar.gz 2>/dev/null | wc -l)
    echo "  ✅ 备份完成（$SIZE，本地共保留 $KEPT 份）"
  else
    echo "  [DRY-RUN] tar -czf $BACKUP_FILE ..."
  fi
else
  echo "▶ 1/3 跳过本地备份（--no-backup）"
fi

# ─── 2. push 到 GitHub ───
echo ""
if $DO_PUSH; then
  echo "▶ 2/3 推送到 GitHub"
  # 防呆：有未提交改动时先停下，让用户处理
  if ! $DRY_RUN && ! git diff-index --quiet HEAD --; then
    echo "  ❌ 有未提交的改动，请先 git commit 或 git stash:"
    git status --short
    exit 1
  fi
  if $DRY_RUN; then
    echo "  [DRY-RUN] git push origin main"
  else
    git push origin main
  fi
else
  echo "▶ 2/3 跳过 push（--skip-push）"
fi

# ─── 3. 部署到 VMs ───
echo ""
echo "▶ 3/3 部署到 VMs"
TOTAL=0; OK=0; FAIL=0
FAILED=()

while IFS= read -r line || [[ -n "$line" ]]; do
  # 去行内注释 + 两端空白
  line="${line%%#*}"
  line="$(echo "$line" | xargs)"
  [[ -z "$line" ]] && continue

  read -r project zone instance dir <<< "$line"
  if [[ -z "$project" || -z "$zone" || -z "$instance" || -z "$dir" ]]; then
    echo "  ⚠️ 跳过格式错误的行: $line"
    continue
  fi

  # --only 过滤（子串匹配实例名）
  if [[ -n "$ONLY" && "$instance" != *"$ONLY"* ]]; then
    continue
  fi

  TOTAL=$((TOTAL+1))
  echo ""
  echo "  ──[ $instance @ $project / $zone ]──"

  REMOTE_CMD="cd $dir \
    && git pull --ff-only \
    && docker compose up -d --build \
    && docker image prune -f \
    && echo '  当前 commit: '\$(git rev-parse --short HEAD)"

  if $DRY_RUN; then
    echo "    [DRY-RUN] gcloud compute ssh $instance --project=$project --zone=$zone --command='...'"
    OK=$((OK+1))
    continue
  fi

  if gcloud compute ssh "$instance" \
       --project="$project" \
       --zone="$zone" \
       --command="$REMOTE_CMD"; then
    OK=$((OK+1))
    echo "  ✅ $instance 完成"
  else
    FAIL=$((FAIL+1))
    FAILED+=("$instance ($project)")
    echo "  ❌ $instance 失败"
  fi
done < "$TARGETS_FILE"

# ─── 总结 ───
echo ""
echo "════════════════════════════════════════════════"
echo "  部署完成：成功 $OK / 失败 $FAIL / 共 $TOTAL"
if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "  失败实例:"
  for fi in "${FAILED[@]}"; do
    echo "    - $fi"
  done
  exit 1
fi
echo "════════════════════════════════════════════════"
