// 2026-08-15 同步批次回归：
//  同步1 口述收款三选一文案（默认：挂账 / 默认：已收款，不出现"没提"行话）
//  同步2 顺便建档勾选（没档案的商品可一并建档并扣库存）
//  同步4 登录页忘记密码三段文案
// 口述这块走文字输入通道真调后端 AI，不是造假数据。
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stockmate/core/api.dart';
import 'package:stockmate/main.dart';

Future<void> _pumpFor(WidgetTester t, Duration d) async {
  final end = DateTime.now().add(d);
  while (DateTime.now().isBefore(end)) { await t.pump(const Duration(milliseconds: 200)); }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    final a = await Api.I.post('/auth/login', data: {'username': 'admin', 'password': 'admin123'});
    await Api.I.setToken(a['token']);
    (await SharedPreferences.getInstance()).setBool('privacy_agreed_v1', true);
  });

  testWidgets('同步1+2：记名客户没说收款→默认挂账；没档案商品→顺便建档勾选', (t) async {
    await t.pumpWidget(const ProviderScope(child: StockMateApp()));
    await _pumpFor(t, const Duration(seconds: 3));
    if (find.text('同意并继续').evaluate().isNotEmpty) {
      await t.tap(find.text('同意并继续'));
      await _pumpFor(t, const Duration(seconds: 3));
    }
    await t.tap(find.byIcon(Icons.mic_rounded).first);
    await _pumpFor(t, const Duration(seconds: 3));

    await t.enterText(find.byType(TextField).first, '老王烟酒行拿走2瓶雪花啤酒，还有3包星际口味薯片');
    await _pumpFor(t, const Duration(seconds: 2));
    await t.tap(find.textContaining('解析').first);
    await _pumpFor(t, const Duration(seconds: 20)); // 真调 AI，给足时间

    expect(find.textContaining('没提'), findsNothing, reason: '★ 不该再出现"没提"这种系统行话');
    expect(find.textContaining('默认：'), findsWidgets, reason: '★ 没说收款的行应显示「默认：xx」');
    expect(find.textContaining('顺便建档到'), findsWidgets, reason: '★ 没档案的商品应给"顺便建档"勾选');
    // ignore: avoid_print
    print('SHOT:sync-voice');
    await _pumpFor(t, const Duration(seconds: 6));

    // 点开三选一，确认三个选项都在。
    // 标签在 Wrap 里可能被滚出视野或被其他行盖住，先 ensureVisible 再点；
    // 弹窗是异步的，用轮询等它出来，别赌固定时长。
    final tag = find.textContaining('默认：').first;
    await t.ensureVisible(tag);
    await _pumpFor(t, const Duration(seconds: 1));
    await t.tap(tag, warnIfMissed: false);
    final sheetDeadline = DateTime.now().add(const Duration(seconds: 10));
    while (find.text('这笔钱收了吗？').evaluate().isEmpty && DateTime.now().isBefore(sheetDeadline)) {
      await t.pump(const Duration(milliseconds: 300));
    }
    expect(find.text('这笔钱收了吗？'), findsOneWidget, reason: '★ 点收款标签应弹出三选一');
    expect(find.text('已收款'), findsWidgets, reason: '★ 选项一');
    expect(find.text('挂账（先欠着）'), findsWidgets, reason: '★ 选项二');
    // ignore: avoid_print
    print('SHOT:sync-paid-sheet');
    await _pumpFor(t, const Duration(seconds: 5));
  });

  testWidgets('同步4：登录页忘记密码三段文案', (t) async {
    // 退出登录：直接清 SharedPreferences 里的 token，App 冷启就会落到登录页
    await Api.I.setToken(null);
    (await SharedPreferences.getInstance()).remove('token');
    await t.pumpWidget(const ProviderScope(child: StockMateApp()));
    await _pumpFor(t, const Duration(seconds: 4));
    if (find.text('同意并继续').evaluate().isNotEmpty) {
      await t.tap(find.text('同意并继续'));
      await _pumpFor(t, const Duration(seconds: 3));
    }
    expect(find.text('忘记密码？'), findsWidgets, reason: '★ 登录页应有忘记密码入口');
    await t.tap(find.text('忘记密码？').first);
    await _pumpFor(t, const Duration(seconds: 2));
    expect(find.textContaining('设置→员工管理→重置密码'), findsOneWidget, reason: '★ 员工那段');
    expect(find.textContaining('qxju.shop/stockmate/support'), findsOneWidget, reason: '★ 店主那段');
    expect(find.textContaining('不需要密码'), findsOneWidget, reason: '★ Apple 那段');
    // ignore: avoid_print
    print('SHOT:sync-forgot');
    await _pumpFor(t, const Duration(seconds: 5));
  });
}
