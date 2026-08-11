// 开单页改价回归（对应 2026-08-08 用户反馈"点编辑价格页面就卡了"）：
// 谈价是批发日常——同一件货给不同客户不同价，改价必须点开就能改、改完立刻反映到合计。
// 跑法（后端须在 3100）：flutter test integration_test/edit_price_test.dart -d <udid>
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
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
    // 预置一车货，直接进到"有商品可改价"的状态
    final prods = await Api.I.get('/products', query: {'page': 1, 'pageSize': 50});
    final sku = ((prods['list'] as List).first)['skus'][0];
    final sp = await SharedPreferences.getInstance();
    await sp.setBool('privacy_agreed_v1', true);
    await sp.setString('sale_draft_v1', jsonEncode({
      'customerId': null,
      'items': [
        {'skuId': sku['id'], 'qty': 2.0, 'price': (sku['price'] as num).toDouble(), 'src': 'default'}
      ],
    }));
  });

  tearDownAll(() async {
    (await SharedPreferences.getInstance()).remove('sale_draft_v1');
  });

  testWidgets('开单页点行改价：面板能开、能改、合计跟着变', (t) async {
    await t.pumpWidget(const ProviderScope(child: StockMateApp()));
    await _pumpFor(t, const Duration(seconds: 3));
    if (find.text('同意并继续').evaluate().isNotEmpty) {
      await t.tap(find.text('同意并继续'));
      await _pumpFor(t, const Duration(seconds: 2));
    }

    // 进开单页（草稿自动恢复出一行货）
    await _waitFor(t, find.byIcon(Icons.receipt_long_rounded));
    await t.tap(find.byIcon(Icons.receipt_long_rounded).first);
    await _waitFor(t, find.byIcon(Icons.add_rounded));
    await t.tap(find.byIcon(Icons.add_rounded).first);
    expect(await _waitFor(t, find.text('提交订单')), true, reason: '应进入开单页');
    await _pumpFor(t, const Duration(seconds: 5)); // 等草稿恢复

    // 点购物车行 → 改价面板
    final line = find.textContaining('¥').first;
    await t.tap(line);
    expect(await _waitFor(t, find.text('确定')), true, reason: '改价面板必须弹出来');
    expect(find.text('删除这行'), findsOneWidget);

    // 键盘弹出后面板不能崩：找到单价输入框改成 99
    final fields = find.descendant(of: find.byType(BottomSheet), matching: find.byType(TextField));
    expect(fields.evaluate().length >= 2, true, reason: '面板应有数量和单价两个输入框');
    await t.enterText(fields.at(1), '99');
    await _pumpFor(t, const Duration(seconds: 1));
    FocusManager.instance.primaryFocus?.unfocus();
    await _pumpFor(t, const Duration(seconds: 1));

    await t.tap(find.text('确定'));
    await _pumpFor(t, const Duration(seconds: 2));

    // 合计必须变成 2 × 99 = 198
    expect(find.textContaining('198'), findsWidgets, reason: '改价后合计应为 2×99=198');
  });
}
