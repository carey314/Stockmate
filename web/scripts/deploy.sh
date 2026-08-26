#!/bin/bash
# Web 管理端部署到生产（qxju.shop/mate）。
# 用法：cd web && bash scripts/deploy.sh
#
# 为什么有这个脚本（2026-08-26 事故）：手动 rsync 时 SSH 被限流掐断，
# 留下 730 字节的半截主 JS（应 309KB），线上强刷即白屏；而且断连后文件名指纹
# 与本地一致——"同名 ≠ 同内容"，只对比文件名会误判部署成功。
# 本脚本：构建 → rsync -azc（内容校验和）→ 逐文件字节级 HTTP 校验 → 探活。
set -euo pipefail
cd "$(dirname "$0")/.."

SSH_KEY=~/.ssh/id_ed25519_tencent
REMOTE=root@qxju.shop:/opt/stockmate/www/mate/
BASE_URL=https://qxju.shop/mate

echo "== 1/4 生产构建 =="
env -u NODE_OPTIONS VITE_BASE=/mate/ VITE_API_BASE=https://qxju.shop/mate-api/api/v1 npm run build | grep "✓ built"

echo "== 2/4 rsync（-c 按内容校验和，断点续传安全）=="
for i in 1 2 3; do
  if rsync -azc --delete -e "ssh -i $SSH_KEY -o ServerAliveInterval=15 -o ConnectTimeout=10" dist/ "$REMOTE"; then
    break
  fi
  echo "  rsync 失败，${i}0 秒后重试（$i/3）…"
  sleep $((i * 10))
  [ "$i" = 3 ] && { echo "❌ rsync 三次失败，线上可能残缺，立即人工检查！"; exit 1; }
done

echo "== 3/4 字节级校验（每个文件本地 vs 线上大小）=="
FAIL=0
TOTAL=0
while IFS= read -r f; do
  TOTAL=$((TOTAL + 1))
  L=$(stat -f%z "dist/$f" 2>/dev/null || stat -c%s "dist/$f")
  # curl 超时/失败不许崩脚本（set -e），记为校验失败并重试一次——服务器慢时误杀
  R=$(curl -s -m 30 -o /dev/null -w "%{size_download}" "$BASE_URL/$f" || echo "-1")
  if [ "$L" != "$R" ]; then
    R=$(curl -s -m 30 -o /dev/null -w "%{size_download}" "$BASE_URL/$f" || echo "-1")
  fi
  if [ "$L" != "$R" ]; then
    echo "  ❌ $f 本地 ${L}B vs 线上 ${R}B"
    FAIL=1
  fi
done < <(cd dist && find . -type f | sed 's|^\./||')
if [ "$FAIL" = 1 ]; then
  echo "❌ 校验失败——线上有残缺文件，禁止收工，重跑本脚本或人工修复"
  exit 1
fi
echo "  ✅ 全部 $TOTAL 个文件字节一致"

echo "== 4/4 探活 =="
CODE=$(curl -s -m 10 -o /dev/null -w "%{http_code}" "$BASE_URL/")
[ "$CODE" = 200 ] && echo "✅ 部署完成，线上 $CODE" || { echo "❌ 线上返回 $CODE"; exit 1; }
