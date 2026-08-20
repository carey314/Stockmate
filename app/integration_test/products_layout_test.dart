// 商品列表布局回归（2026-08-14 用户反馈"布局有点丑"）：
// 标题不重复、负库存有红色警示、单规格不再重复显示库存。
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
  testWidgets('商品列表：标题不重复 / 负库存报警 / 单规格不重复报库存', (t) async {
    await t.pumpWidget(const ProviderScope(child: StockMateApp()));
    await _pumpFor(t, const Duration(seconds: 3));
    if (find.text('同意并继续').evaluate().isNotEmpty) {
      await t.tap(find.text('同意并继续'));
      await _pumpFor(t, const Duration(seconds: 3));
    }
    // 底栏「商品」tab。别用 find.byIcon(...).first：首页内容里也有同名图标，
    // 首页随数据变化时 .first 会落到别处（真踩过——点成了扫码 tab）。
    // 用底栏文字标签定位：find.text 是精确匹配，不会命中「商品库存」。
    await t.tap(find.text('商品').last);
    await _pumpFor(t, const Duration(seconds: 4));

    // 标题只由 SliverAppBar.medium 一处提供（大标题长在 AppBar 里，滚动自动折叠）。
    // 以前是"空 AppBar + 正文大标题"两层，顶部白吃 120+pt，且两处都写"商品库存"。
    expect(find.byType(SliverAppBar), findsOneWidget, reason: '★ 应使用可折叠大标题');
    expect(find.text('商品库存'), findsWidgets, reason: '★ 标题应存在');
    // 默认按主营品类过滤，那个分类商品少、列表滚不动；先切「全部」凑够长度
    await t.tap(find.text('全部'));
    await _pumpFor(t, const Duration(seconds: 3));
    // ignore: avoid_print
    print('SHOT:prod-list');
    await _pumpFor(t, const Duration(seconds: 5));

    // 滚动后 AppBar 标题接管（此时列表还是全量，滚得动）
    await t.drag(find.byType(Scrollable).first, const Offset(0, -260));
    await _pumpFor(t, const Duration(seconds: 2));
    expect(find.text('商品库存'), findsWidgets, reason: '★ 滚动后标题仍在（已折叠成标题栏）');
    // ignore: avoid_print
    print('SHOT:prod-scrolled');
    await _pumpFor(t, const Duration(seconds: 4));

    // 回到顶部，切「全部」+ 搜索，验证负库存警示和去重
    await t.drag(find.byType(Scrollable).first, const Offset(0, 400));
    await _pumpFor(t, const Duration(seconds: 2));
    await t.enterText(find.byType(TextField).first, '古越');
    await _pumpFor(t, const Duration(seconds: 4));
    expect(find.textContaining('卖超了'), findsWidgets, reason: '★ 负库存商品应显示"卖超了"警示');
    expect(find.textContaining('库存-5'), findsNothing, reason: '★ 单规格不该再用 chip 把库存说第二遍');
    // ignore: avoid_print
    print('SHOT:prod-negative');
    await _pumpFor(t, const Duration(seconds: 5));
  });
}
