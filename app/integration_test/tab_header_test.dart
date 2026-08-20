// 三个 tab 页头部统一回归（2026-08-16）：商品/订单/我的 都用可折叠大标题，
// 不再是"空 AppBar + 正文大标题"两层（顶部白吃 120+pt 且标题重复）。
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stockmate/core/api.dart';
import 'package:stockmate/core/theme.dart';
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

  testWidgets('商品/订单/我的：都用可折叠大标题且只出现一处标题', (t) async {
    await t.pumpWidget(const ProviderScope(child: StockMateApp()));
    await _pumpFor(t, const Duration(seconds: 3));
    if (find.text('同意并继续').evaluate().isNotEmpty) {
      await t.tap(find.text('同意并继续'));
      await _pumpFor(t, const Duration(seconds: 3));
    }
    // 底栏中间的「开单」是大圆按钮，只有图标没有文字标签，只能按图标找
    for (final (tab, title) in [('商品', '商品库存'), ('开单', '订单'), ('我的', '我的')]) {
      await t.tap(tab == '开单'
          ? find.byIcon(Icons.receipt_long_rounded).first
          : find.text(tab).last);
      await _pumpFor(t, const Duration(seconds: 3));
      expect(find.byType(AppLargeTitleBar), findsOneWidget, reason: '★「$tab」应使用统一的可折叠大标题');
      expect(find.text(title), findsWidgets, reason: '★「$tab」标题「$title」应存在');
      // ignore: avoid_print
      print('SHOT:tab-$tab');
      await _pumpFor(t, const Duration(seconds: 4));
    }
  });
}
