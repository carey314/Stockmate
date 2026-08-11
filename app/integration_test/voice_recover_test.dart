// 语音状态机卡死回归测试（对应 2026-08-05 截图 bug）：
// 模拟器上语音引擎必失败（error_listen_failed，苹果限制），此时界面必须：
//   1. 复位（不卡在"正在听"+红色停止按钮）
//   2. 给人话提示（不怼原始错误码）
//   3. 第二次点击依然不卡死（原 bug：permanent 错误后未重建引擎 → listen 静默失败 → 永久卡死）
// 跑法（后端须在 3100）：flutter test integration_test/voice_recover_test.dart -d <udid>
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stockmate/core/api.dart';
import 'package:stockmate/features/voice/voice_entry_screen.dart';
import 'package:stockmate/main.dart';

Future<void> _waitFor(WidgetTester t, Finder f, {int tries = 40}) async {
  for (var i = 0; i < tries; i++) {
    await t.pump(const Duration(milliseconds: 250));
    if (f.evaluate().isNotEmpty) return;
  }
  // 超时诊断：把当前树上的文本全打出来，一眼看出停在哪个页面
  final texts = find.byType(Text).evaluate().map((e) => (e.widget as Text).data ?? '').where((s) => s.isNotEmpty).take(30).join(' | ');
  throw TestFailure('等不到控件: $f\n当前页面文本: $texts');
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() async {
    // 预写隐私同意标记，绕过首启同意页（同意页本身由 widget 测试覆盖）
    (await SharedPreferences.getInstance()).setBool('privacy_agreed_v1', true);
    // 预先登录注入 token，app 启动直接进主框架（跳过登录页）
    final auth = await Api.I.post('/auth/login', data: {'username': 'admin', 'password': 'admin123'});
    await Api.I.setToken(auth['token']);
  });

  testWidgets('语音失败后界面复位，二次点击不卡死', (t) async {
    await t.pumpWidget(const ProviderScope(child: StockMateApp()));
    await t.pump(const Duration(milliseconds: 1500));

    // 先确认进了主框架（底栏是静态的，不依赖数据）
    await _waitFor(t, find.byIcon(Icons.receipt_long_rounded));
    // 首页 → AI 口述记账（overview 数据回来后渐变卡才在树上；标题不可点，点卡里的"开始记账"按钮）
    await _waitFor(t, find.text('开始记账'), tries: 60);
    await t.ensureVisible(find.text('开始记账'));
    await t.tap(find.text('开始记账'));
    await _waitFor(t, find.text('AI 解析'));

    // 模拟器上引擎必失败（onError 或"表面成功几秒后悄悄死"两种模式都有）。
    // 同一循环里同时盯两件事：界面复位 + 人话提示出现过（SnackBar 只停 4 秒，串行等会错过）
    // 首页的"开始记账"按钮里也有 mic_rounded（push 后仍在 Navigator 栈里，find 找得到但点不着），
    // 必须限定在语音页内找，否则 .first 会打空
    final micInPage = find.descendant(of: find.byType(VoiceEntryScreen), matching: find.byIcon(Icons.mic_rounded));

    Future<void> tapMicAndVerify(String round) async {
      await t.tap(micInPage.first);
      var sawHint = false;
      var gone = false;
      final trace = StringBuffer(); // 每 tick 记录 UI 状态：S=stop在 H=提示在
      for (var i = 0; i < 48; i++) {
        await t.pump(const Duration(milliseconds: 250));
        final hintNow = find.textContaining('先打字').evaluate().isNotEmpty;
        if (hintNow) sawHint = true;
        gone = find.byIcon(Icons.stop_rounded).evaluate().isEmpty;
        trace.write(gone ? (hintNow ? 'h' : '.') : (hintNow ? 'X' : 'S'));
        if (gone && sawHint) break;
      }
      final timeline = '${VoiceEntryScreen.debugEvents.join('\n  ')}\nUI轨迹[$trace]';
      expect(gone, true, reason: '$round：失败后不许卡在"正在听"\n事件线:\n  $timeline');
      expect(find.textContaining('正在听'), findsNothing, reason: '$round：不许残留"正在听"');
      expect(sawHint, true, reason: '$round：失败必须给人话提示（含键盘听写引导）\n事件线:\n  $timeline');
    }

    await tapMicAndVerify('第一次');
    // 第二次点击（原 bug 必现场景）：permanent 错误后引擎需重建，仍不许卡死
    await t.pump(const Duration(seconds: 5)); // 让第一次的 SnackBar 退场，避免误捕
    await tapMicAndVerify('第二次');
  });
}
