#!/bin/bash
# App Store 截图：跑 screenshot_driver_test 驱动导航，见到 SHOT: 标记就 simctl 截图。
# 用法：bash scripts/shoot.sh [模拟器UDID]
# 产物：docs/screenshots/*.png（6.9" 1320×2868，App Store Connect 直接可传）
set -uo pipefail
UDID="${1:-E7493A1D-A9DA-4B7C-9308-E058BB9E1DCD}"   # 默认 iPhone 17 Pro Max
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SHOT_DIR="$APP_DIR/../docs/screenshots"
LOG=/tmp/stockmate-shoot.log
mkdir -p "$SHOT_DIR"
rm -f "$LOG"

# 商店截图规范：状态栏统一成 9:41 满信号满电（苹果自家宣传图的惯例）
xcrun simctl status_bar "$UDID" override --time "9:41" --batteryState charged --batteryLevel 100 \
  --cellularMode active --cellularBars 4 --wifiMode active --wifiBars 3 --dataNetwork wifi >/dev/null 2>&1
# 关掉 iOS 键盘的"滑动输入"教学浮层，否则会盖住半屏
xcrun simctl spawn "$UDID" defaults write com.apple.keyboard.preferences DidShowContinuousPathIntroduction -bool true >/dev/null 2>&1

export PATH="$HOME/projects/flutter/bin:$PATH"
cd "$APP_DIR"
flutter test integration_test/screenshot_driver_test.dart -d "$UDID" \
  --dart-define=API_BASE=https://qxju.shop/mate-api/api/v1 \
  --dart-define=DEMO_USER=review \
  --dart-define=DEMO_PASS=ReviewDemo2026 > "$LOG" 2>&1 &
TEST_PID=$!

# 跟着日志走：每见到一个新的 SHOT: 标记，等 2 秒让动画稳定再截
seen=""
while kill -0 $TEST_PID 2>/dev/null; do
  marker=$(grep -o 'SHOT:[^ ]*' "$LOG" 2>/dev/null | tail -1)
  if [ -n "$marker" ] && [ "$marker" != "$seen" ]; then
    seen="$marker"
    name="${marker#SHOT:}"
    if [ "$name" = "DONE" ]; then break; fi
    sleep 2
    xcrun simctl io "$UDID" screenshot "$SHOT_DIR/$name.png" >/dev/null 2>&1
    echo "  📸 $name"
  fi
  sleep 0.4
done
wait $TEST_PID 2>/dev/null
echo "--- 测试结果 ---"; tail -3 "$LOG"
echo "--- 产物 ---"; ls -1 "$SHOT_DIR" 2>/dev/null
