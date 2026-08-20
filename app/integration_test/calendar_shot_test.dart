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
  testWidgets('收益日历：月视图概览 + 周视图逐笔铺开', (t) async {
    await t.pumpWidget(const ProviderScope(child: StockMateApp()));
    await _pumpFor(t, const Duration(seconds: 3));
    if (find.text('同意并继续').evaluate().isNotEmpty) {
      await t.tap(find.text('同意并继续'));
      await _pumpFor(t, const Duration(seconds: 3));
    }
    // 入口已提级：我的 → 收益日历（和报表中心同级，不再钻进报表中心）
    await t.tap(find.text('我的').last);
    await _pumpFor(t, const Duration(seconds: 2));
    await t.scrollUntilVisible(find.text('收益日历'), 200, scrollable: find.byType(Scrollable).first);
    await t.tap(find.text('收益日历'));
    await _pumpFor(t, const Duration(seconds: 4));
    // 月视图：格子 + 日/月/年概览
    expect(find.text('月'), findsOneWidget);
    expect(find.text('周'), findsOneWidget);
    expect(find.textContaining('累计'), findsWidgets, reason: '月视图应有月/年累计');
    // ignore: avoid_print
    print('SHOT:cal-month');
    await _pumpFor(t, const Duration(seconds: 7));
    // 周视图：事件小卡直接铺在每天的列里 + 下方逐笔清单
    await t.tap(find.text('周'));
    await _pumpFor(t, const Duration(seconds: 4));
    // 点一个有数据的日子（11号）——下方清单应逐笔列出金额
    if (find.text('11').evaluate().isNotEmpty) {
      await t.tap(find.text('11').first);
      await _pumpFor(t, const Duration(seconds: 2));
    }
    expect(find.textContaining('¥'), findsWidgets, reason: '清单应逐笔列出金额');
    // ignore: avoid_print
    print('SHOT:cal-week');
    await _pumpFor(t, const Duration(seconds: 7));
  });
}
