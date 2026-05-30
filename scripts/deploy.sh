#!/usr/bin/env bash
# 一键部署：本地备份 → push 到 GitHub → SSH 三台 VM pull + 重建 Docker
#
# 用法：
#   bash scripts/deploy.sh                 # 备份 + push + 并行部署全部 VM
#   bash scripts/deploy.sh --skip-push     # 跳过 push（VM 直接拉当前 origin/main）
#   bash scripts/deploy.sh --no-backup     # 不备份（不推荐）
#   bash scripts/deploy.sh --only=1-sg     # 只部署 instance 名包含 '1-sg' 的
#   bash scripts/deploy.sh --sequential    # 串行部署（老行为，调试某台时用）
#   bash scripts/deploy.sh --dry-run       # 只打印命令不执行
#   bash scripts/deploy.sh --help
#
# v2 (2026-05)：默认改成 3 台 VM 并行部署，把总耗时从 ~18 分钟降到 ~6 分钟
# （三台 VM 同时跑 docker build，每台日志收集到独立文件，最后汇总展示）

set -euo pipefail

# ─── 解析参数 ───
ONLY=""
DRY_RUN=false
DO_BACKUP=true
DO_PUSH=true
PARALLEL=true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --only=*)     ONLY="${1#*=}"; shift ;;
    --only)       ONLY="$2"; shift 2 ;;
    --dry-run)    DRY_RUN=true; shift ;;
    --no-backup)  DO_BACKUP=false; shift ;;
    --skip-push)  DO_PUSH=false; shift ;;
    --sequential|--no-parallel) PARALLEL=false; shift ;;
    -h|--help)
      sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
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
if $PARALLEL; then
  echo "▶ 3/3 并行部署到 VMs（3 台同时跑 docker build，日志暂存到 /tmp/deploy-*.log）"
else
  echo "▶ 3/3 串行部署到 VMs（--sequential）"
fi
TOTAL=0; OK=0; FAIL=0
FAILED=()

# 解析 targets 文件成数组
declare -a TGT_PROJECTS=() TGT_ZONES=() TGT_INSTANCES=() TGT_DIRS=()
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
  TGT_PROJECTS+=("$project")
  TGT_ZONES+=("$zone")
  TGT_INSTANCES+=("$instance")
  TGT_DIRS+=("$dir")
done < "$TARGETS_FILE"

TOTAL=${#TGT_INSTANCES[@]}

# ─── 单台 VM 部署函数 ───
# 用法：deploy_one <project> <zone> <instance> <dir> <log_file>
# 成功 exit 0；失败 exit 1
deploy_one() {
  local project="$1" zone="$2" instance="$3" dir="$4" log="$5"
  # 注：Caddyfile 是 mounted volume（:ro），改了配置 docker compose up --build 不会
  # 自动 reload caddy；这里加一条 `caddy reload`（失败就 fallback 到 restart），
  # 避免改 Caddyfile 之后部署完线上还在用旧配置
  local REMOTE_CMD="cd $dir \
    && git pull --ff-only \
    && docker compose up -d --build \
    && (docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile 2>/dev/null \
        || docker compose restart caddy) \
    && docker image prune -f \
    && echo '  当前 commit: '\$(git rev-parse --short HEAD)"
  if $DRY_RUN; then
    echo "    [DRY-RUN] gcloud compute ssh $instance --project=$project --zone=$zone" > "$log"
    return 0
  fi
  gcloud compute ssh "$instance" \
    --project="$project" \
    --zone="$zone" \
    --strict-host-key-checking=no \
    --quiet \
    --command="$REMOTE_CMD" \
    < /dev/null \
    > "$log" 2>&1
}

if $PARALLEL && [[ $TOTAL -gt 1 ]]; then
  # ─── 并行模式：3 台同时跑，日志各自 tmp 文件 ───
  declare -a PIDS=()
  declare -a LOGS=()
  for i in "${!TGT_INSTANCES[@]}"; do
    # 变量名避开 `local`（bash 关键字撞名兼容性问题）
    log_path="/tmp/deploy-${TGT_INSTANCES[$i]}-$$.log"
    LOGS+=("$log_path")
    echo "  ⏵ 启动 [${TGT_INSTANCES[$i]} @ ${TGT_PROJECTS[$i]} / ${TGT_ZONES[$i]}]"
    deploy_one "${TGT_PROJECTS[$i]}" "${TGT_ZONES[$i]}" "${TGT_INSTANCES[$i]}" "${TGT_DIRS[$i]}" "$log_path" &
    PIDS+=($!)
  done

  # 等所有（用 || true 防止某台失败时 set -e 提前 exit）
  echo ""
  echo "  ⏳ 等待全部 $TOTAL 台 VM build 完成（~5-7 分钟，三台并行）…"
  for i in "${!PIDS[@]}"; do
    if wait "${PIDS[$i]}" 2>/dev/null; then
      OK=$((OK+1))
      echo ""
      echo "  ──[ ${TGT_INSTANCES[$i]} @ ${TGT_PROJECTS[$i]} ]── ✅"
      tail -n 40 "${LOGS[$i]}" 2>/dev/null | sed 's/^/    /' || true
    else
      FAIL=$((FAIL+1))
      FAILED+=("${TGT_INSTANCES[$i]} (${TGT_PROJECTS[$i]})")
      echo ""
      echo "  ──[ ${TGT_INSTANCES[$i]} @ ${TGT_PROJECTS[$i]} ]── ❌"
      tail -n 60 "${LOGS[$i]}" 2>/dev/null | sed 's/^/    /' || true
    fi
  done

  # 清理日志（如果需要 debug 可以保留）
  # for log in "${LOGS[@]}"; do rm -f "$log"; done
else
  # ─── 串行模式（--sequential 或只有 1 台时） ───
  for i in "${!TGT_INSTANCES[@]}"; do
    echo ""
    echo "  ──[ ${TGT_INSTANCES[$i]} @ ${TGT_PROJECTS[$i]} / ${TGT_ZONES[$i]} ]──"
    if deploy_one "${TGT_PROJECTS[$i]}" "${TGT_ZONES[$i]}" "${TGT_INSTANCES[$i]}" "${TGT_DIRS[$i]}" "/dev/stdout"; then
      OK=$((OK+1))
      echo "  ✅ ${TGT_INSTANCES[$i]} 完成"
    else
      FAIL=$((FAIL+1))
      FAILED+=("${TGT_INSTANCES[$i]} (${TGT_PROJECTS[$i]})")
      echo "  ❌ ${TGT_INSTANCES[$i]} 失败"
    fi
  done
fi

# ─── 总结（显式 exit 0 防止 trailing exit code 触发 set -e 报错） ───
echo ""
echo "════════════════════════════════════════════════"
echo "  部署完成：成功 $OK / 失败 $FAIL / 共 $TOTAL"
if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "  失败实例:"
  for failed_inst in "${FAILED[@]}"; do
    echo "    - $failed_inst"
  done
  exit 1
fi
echo "════════════════════════════════════════════════"
exit 0
