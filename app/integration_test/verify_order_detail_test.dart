// 订单详情底栏布局验证（对应用户反馈"布局样式有问题"：退货/分享文字被挤换行）
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:stockmate/core/api.dart';
import 'package:stockmate/main.dart';

Future<void> _pumpFor(WidgetTester t, Duration d) async {
  final end = DateTime.now().add(d);
  while (DateTime.now().isBefore(end)) {
    await t.pump(const Duration(milliseconds: 200));
  }
}

Future<bool> _waitFor(WidgetTester t, Finder f, {int tries = 60}) async {
  for (var i = 0; i < tries; i++) {
    await t.pump(const Duration(milliseconds: 250));
    if (f.evaluate().isNotEmpty) return true;
  }
  return false;
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    final auth = await Api.I.post('/auth/login', data: {'username': 'admin', 'password': 'admin123'});
    await Api.I.setToken(auth['token']);
  });

  testWidgets('订单详情底栏四个动作齐全且不崩布局', (t) async {
    await t.pumpWidget(const ProviderScope(child: StockMateApp()));
    await _pumpFor(t, const Duration(seconds: 3));
    if (find.text('同意并继续').evaluate().isNotEmpty) {
      await t.tap(find.text('同意并继续'));
      await _pumpFor(t, const Duration(seconds: 3));
    }
    await _waitFor(t, find.byIcon(Icons.receipt_long_rounded));
    await t.tap(find.byIcon(Icons.receipt_long_rounded).first);
    await _pumpFor(t, const Duration(seconds: 3));
    // 点第一张单进详情
    final row = find.textContaining('SO');
    expect(await _waitFor(t, row), true, reason: '订单列表应有单据');
    await t.tap(row.first);
    expect(await _waitFor(t, find.text('分享单据图片')), true, reason: '底栏主按钮应完整显示');
    await _pumpFor(t, const Duration(seconds: 2));
    // 三个次要动作各自完整（之前"退货"被挤成两行、"分享单据图片"也换行）
    for (final label in ['再来一单', '打印小票']) {
      expect(find.text(label), findsOneWidget, reason: '$label 应完整成行显示');
    }
    // ignore: avoid_print
    print('SHOT:order-detail');
    await _pumpFor(t, const Duration(seconds: 8));
  });
}
