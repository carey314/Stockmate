// 库存流水页冒烟（2026-08-21，两端对齐四件套的 App 半边）：
// 1) 出入库页右上角能进全店流水；2) 商品详情能进单品流水；
// 3) 页面要么有流水行（含「n → m」前后库存文本），要么显示空态文案——不允许白屏/报错。
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
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

  testWidgets('库存流水：出入库入口 + 商品详情入口都能打开且不白屏', (t) async {
    await t.pumpWidget(const ProviderScope(child: StockMateApp()));
    await _pumpFor(t, const Duration(seconds: 3));
    if (find.text('同意并继续').evaluate().isNotEmpty) {
      await t.tap(find.text('同意并继续'));
      await _pumpFor(t, const Duration(seconds: 3));
    }

    // 入口一：我的 → 出入库 → 右上角流水
    await t.tap(find.text('我的').last);
    await _pumpFor(t, const Duration(seconds: 2));
    await t.tap(find.text('出入库（报损/自用）'));
    await _pumpFor(t, const Duration(seconds: 2));
    await t.tap(find.byTooltip('库存流水'));
    await _pumpFor(t, const Duration(seconds: 3));
    expect(find.text('库存流水'), findsWidgets, reason: '★ 全店流水页要能打开');
    final hasRows = find.textContaining(' → ').evaluate().isNotEmpty;
    final hasEmpty = find.textContaining('还没有库存变动').evaluate().isNotEmpty;
    expect(hasRows || hasEmpty, isTrue, reason: '★ 要么有「前 → 后」流水行，要么有空态，不许白屏');
    // ignore: avoid_print
    print('SHOT:records');
    await _pumpFor(t, const Duration(seconds: 4));
    // 中文环境返回键 tooltip 是「返回」，pageBack() 只认 'Back'——按类型找才稳
    await t.tap(find.byType(BackButton).first);
    await _pumpFor(t, const Duration(seconds: 1));
    await t.tap(find.byType(BackButton).first);
    await _pumpFor(t, const Duration(seconds: 1));

    // 入口二：商品 → 第一个商品详情 → 变动记录
    await t.tap(find.text('商品').last);
    await _pumpFor(t, const Duration(seconds: 2));
    final firstCard = find.textContaining('规格 ·').first; // 商品行副标题「N个规格 · ¥x起」
    await t.tap(firstCard);
    await _pumpFor(t, const Duration(seconds: 2));
    expect(find.text('变动记录'), findsOneWidget, reason: '★ 商品详情要有变动记录入口');
    await t.tap(find.text('变动记录'));
    await _pumpFor(t, const Duration(seconds: 3));
    expect(find.textContaining('· 流水'), findsWidgets, reason: '★ 单品流水页标题带商品名');
  });
}
