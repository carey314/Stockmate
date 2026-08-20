#!/bin/bash
# 跑集成测试的唯一正确姿势。
#
# 为什么必须走这个脚本：api.dart 的 API_BASE 默认值指向**生产**（这是刻意的，
# 防止打 release 包忘传参数得到一个连不上后端的废包）。但集成测试会真开单、真扣库存——
# 直接 `flutter test integration_test/x.dart` 就是往线上演示店写垃圾数据。
#
# 用法：bash scripts/itest.sh core_flows_test [更多测试名...]
set -uo pipefail
UDID="${SM_UDID:-48DDF7B5-2665-46F2-A794-B1C76BD7E52D}"
LOCAL_API="http://localhost:3100/api/v1"
export PATH="$HOME/projects/flutter/bin:$PATH"
cd "$(dirname "$0")/.."

curl -s -m 3 http://localhost:3100/health >/dev/null || { echo "❌ 本地后端没起来（localhost:3100），先启动再跑测试"; exit 1; }

for f in "$@"; do
  echo "── $f"
  env -u NODE_OPTIONS flutter test "integration_test/$f.dart" -d "$UDID" \
    --dart-define=API_BASE="$LOCAL_API" 2>&1 | tail -3
done
