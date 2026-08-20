// 表单标签回归（2026-08-14 用户反馈"有数值时根本不知道是什么信息"）：
// 填了值之后，字段标签必须还在——以前用 hintText 当标签，一有值就消失。
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
  testWidgets('编辑商品：填了值之后标签依然可见', (t) async {
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
    await t.tap(find.text('全部'));
    await _pumpFor(t, const Duration(seconds: 3));
    await t.enterText(find.byType(TextField).first, '猪肉');
    await _pumpFor(t, const Duration(seconds: 4));
    await t.tap(find.text('猪肉').last); // 搜索框里也有猪肉，取列表里那个
    await _pumpFor(t, const Duration(seconds: 4));
    // 详情页 → 右上角编辑
    await t.tap(find.byTooltip('编辑'));
    await _pumpFor(t, const Duration(seconds: 4));

    // 这些字段都有值（商品已存在），标签必须仍然显示出来
    // 猪肉没有规格维度，售价/成本价/预警线是直接摆在表单上的普通字段
    for (final label in ['商品名称', '单位（斤/瓶/箱…）', '售价 ¥', '成本价 ¥（选填）', '预警线（选填）']) {
      expect(find.text(label), findsWidgets, reason: '★ 有值时「$label」标签仍应可见');
    }
    // ignore: avoid_print
    print('SHOT:form-labels');
    await _pumpFor(t, const Duration(seconds: 6));
  });
}
