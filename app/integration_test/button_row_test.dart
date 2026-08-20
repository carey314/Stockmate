// 按钮行回归（2026-08-16 用户反馈"添加商品被挤成两行"）：
// 进货单三按钮 / 销售开单两按钮，在默认字号和放大字号下都必须单行、等高。
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

/// 断言这些按钮都是单行且高度一致（换行会让某个按钮变高）
void _assertSingleLineRow(WidgetTester t, List<String> labels, String where) {
  final heights = <double>[];
  for (final l in labels) {
    final f = find.text(l);
    expect(f, findsWidgets, reason: '★ $where 应有「$l」按钮');
    final box = t.renderObject(find.ancestor(of: f.first, matching: find.byType(OutlinedButton)).first) as RenderBox;
    heights.add(box.size.height);
    // 单行文字的渲染高度不会超过约 2 倍行高；换行了就会明显变高
    final textBox = t.renderObject(f.first) as RenderBox;
    expect(textBox.size.height < 34, true,
        reason: '★ $where 的「$l」换行了（高 ${textBox.size.height}），按钮宽度不够');
  }
  final maxH = heights.reduce((a, b) => a > b ? a : b);
  final minH = heights.reduce((a, b) => a < b ? a : b);
  expect(maxH - minH < 1, true, reason: '★ $where 按钮高度应一致，实际 $heights');
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    final a = await Api.I.post('/auth/login', data: {'username': 'admin', 'password': 'admin123'});
    await Api.I.setToken(a['token']);
    (await SharedPreferences.getInstance()).setBool('privacy_agreed_v1', true);
  });

  Future<void> gotoPurchase(WidgetTester t, {double textScale = 1.0}) async {
    // 只覆盖字号，其余（安全区 padding 等）必须取真实值——
    // 从零构造 MediaQueryData 会把刘海/底部安全区抹掉，截出来的图是失真的
    await t.pumpWidget(MediaQuery(
      data: MediaQueryData.fromView(t.view).copyWith(textScaler: TextScaler.linear(textScale)),
      child: const ProviderScope(child: StockMateApp()),
    ));
    await _pumpFor(t, const Duration(seconds: 3));
    if (find.text('同意并继续').evaluate().isNotEmpty) {
      await t.tap(find.text('同意并继续'));
      await _pumpFor(t, const Duration(seconds: 3));
    }
    await t.tap(find.text('我的').last);
    await _pumpFor(t, const Duration(seconds: 2));
    await t.scrollUntilVisible(find.text('进货单'), 200, scrollable: find.byType(Scrollable).first);
    await t.tap(find.text('进货单'));
    await _pumpFor(t, const Duration(seconds: 3));
    await t.tap(find.byIcon(Icons.add_rounded).first);
    await _pumpFor(t, const Duration(seconds: 3));
  }

  testWidgets('进货单三按钮：默认字号单行等高', (t) async {
    await gotoPurchase(t);
    _assertSingleLineRow(t, ['添加商品', '扫码', '拍单据'], '新建进货单');
    // ignore: avoid_print
    print('SHOT:btn-purchase');
    await _pumpFor(t, const Duration(seconds: 5));
  });

  testWidgets('进货单三按钮：系统字号放大 1.3 倍仍单行等高', (t) async {
    await gotoPurchase(t, textScale: 1.3);
    _assertSingleLineRow(t, ['添加商品', '扫码', '拍单据'], '新建进货单(大字号)');
    // ignore: avoid_print
    print('SHOT:btn-purchase-big');
    await _pumpFor(t, const Duration(seconds: 5));
  });
}
