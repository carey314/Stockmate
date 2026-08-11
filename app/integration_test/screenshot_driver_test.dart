// App Store 截图驱动：真手点导航到 6 个卖点页面，每站打一个 SHOT 标记后停住，
// 外部脚本 tail 日志见到标记就用 simctl 截图（外部截图才能拿到真机分辨率的 PNG）。
//
// 跑法（配套 scripts/shoot.sh）：
//   flutter test integration_test/screenshot_driver_test.dart -d <udid> \
//     --dart-define=API_BASE=https://qxju.shop/mate-api/api/v1 \
//     --dart-define=DEMO_USER=review --dart-define=DEMO_PASS=ReviewDemo2026
//
// 为什么不用 simctl 直接写偏好跳过隐私同意页：新版 shared_preferences 的存储位置
// 与 simctl 能写到的地方不一致，试过三种写法都被同意页挡住——真手点最省事也最真实。
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stockmate/core/api.dart';
import 'package:stockmate/main.dart';

const _hold = Duration(seconds: 7); // 每站停留，外部脚本在此窗口内截图

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

/// 返回上一页。注意：t.pageBack() 找的是英文 tooltip "Back"，
/// 接了国际化之后中文环境下 tooltip 是"返回"，直接用会报 0 个候选。
Future<void> _back(WidgetTester t) async {
  for (final f in [find.byTooltip('返回'), find.byTooltip('Back'), find.byType(BackButton)]) {
    if (f.evaluate().isNotEmpty) {
      await t.tap(f.first);
      await _pumpFor(t, const Duration(seconds: 2));
      return;
    }
  }
}

/// 打标记 + 停住让外部截图
Future<void> _shot(WidgetTester t, String name) async {
  // ignore: avoid_print
  print('SHOT:$name');
  await _pumpFor(t, _hold);
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() async {
    // 集成测试直接 pumpWidget，不会走 main() 里的自动登录 —— 必须自己登
    const user = String.fromEnvironment('DEMO_USER', defaultValue: 'admin');
    const pass = String.fromEnvironment('DEMO_PASS', defaultValue: 'admin123');
    final auth = await Api.I.post('/auth/login', data: {'username': user, 'password': pass});
    await Api.I.setToken(auth['token']);

    // 预置开单草稿：进开单页自动恢复出一车货。
    // 比在选货弹窗里模拟搜索点击可靠得多（多规格商品还要过选规格面板）
    final prods = await Api.I.get('/products', query: {'page': 1, 'pageSize': 200});
    final list = (prods['list'] as List);
    Map<String, dynamic>? skuOf(String namePart, String specPart) {
      for (final p in list) {
        if (!(p['name'] as String).contains(namePart)) continue;
        for (final k in (p['skus'] as List)) {
          if ((k['specText'] ?? '').toString().contains(specPart)) return {'skuId': k['id'], 'price': k['price']};
        }
      }
      return null;
    }
    final picks = [
      (skuOf('泸州老窖', '单瓶'), 6.0),
      (skuOf('青岛啤酒', '整箱'), 2.0),
      (skuOf('红牛', '整箱'), 1.0),
    ].where((e) => e.$1 != null).toList();
    final custs = await Api.I.get('/customers');
    final cust = (custs['list'] as List).firstWhere((c) => (c['name'] as String).contains('老王'), orElse: () => null);
    final sp = await SharedPreferences.getInstance();
    await sp.setBool('privacy_agreed_v1', true);
    await sp.setString('sale_draft_v1', jsonEncode({
      'customerId': cust?['id'],
      'items': [
        for (final e in picks) {'skuId': e.$1!['skuId'], 'qty': e.$2, 'price': e.$1!['price'], 'src': 'customer'}
      ],
    }));
  });

  testWidgets('拍 6 张商店截图', (t) async {
    await t.pumpWidget(const ProviderScope(child: StockMateApp()));
    await _pumpFor(t, const Duration(seconds: 3));

    // 首启同意页（全新容器每次都会弹）
    if (find.text('同意并继续').evaluate().isNotEmpty) {
      await t.tap(find.text('同意并继续'));
      await _pumpFor(t, const Duration(seconds: 3));
    }
    await _waitFor(t, find.byIcon(Icons.grid_view_rounded));
    await _pumpFor(t, const Duration(seconds: 4)); // 等首页数据

    // ① 首页（AI 口述记账渐变卡 + 今日毛利）
    await _shot(t, '01-首页');

    // ② 语音口述确认卡（最能打的一张：AI 拆出进货/卖出/开销）
    if (await _waitFor(t, find.text('开始记账'))) {
      await t.ensureVisible(find.text('开始记账'));
      await t.tap(find.text('开始记账'));
      await _waitFor(t, find.text('AI 解析'));
      final box = find.byType(TextField).first;
      await t.enterText(box, '今天进了2箱青岛啤酒192，卖给老王饭店5瓶泸州老窖，摊位费80');
      await _pumpFor(t, const Duration(seconds: 1));
      await t.tap(find.text('AI 解析'));
      await _waitFor(t, find.textContaining('确认'), tries: 100); // 等 DeepSeek
      // 收起键盘（不然 iOS 键盘和它的教学浮层会盖掉半屏）
      FocusManager.instance.primaryFocus?.unfocus();
      await _pumpFor(t, const Duration(seconds: 2));
      // 把确认卡滚上来当主角
      final sv = find.byType(Scrollable).first;
      await t.drag(sv, const Offset(0, -260));
      await _pumpFor(t, const Duration(seconds: 2));
      await _shot(t, '02-口述确认');
      await _back(t);
    }

    // ③ 品类管理（AI 配字段）
    await t.tap(find.text('我的').last);
    await _pumpFor(t, const Duration(seconds: 2));
    if (await _waitFor(t, find.text('品类管理'))) {
      await t.tap(find.text('品类管理'));
      await _pumpFor(t, const Duration(seconds: 3));
      await _shot(t, '03-品类管理');
      await _back(t);
    }

    // ④ 开单页（购物车里有货）
    await t.tap(find.byIcon(Icons.receipt_long_rounded).first);
    await _pumpFor(t, const Duration(seconds: 2));
    if (await _waitFor(t, find.byIcon(Icons.add_rounded))) {
      await t.tap(find.byIcon(Icons.add_rounded).first);
      await _waitFor(t, find.text('提交订单'));
      // 等草稿恢复 + 等"已恢复"提示条自己消失（不然会盖住底部合计）
      await _pumpFor(t, const Duration(seconds: 7));
      await _shot(t, '04-开单');
      await _back(t);
    }

    // ⑤ 客户欠款
    await t.tap(find.text('我的').last);
    await _pumpFor(t, const Duration(seconds: 2));
    if (await _waitFor(t, find.textContaining('客户'))) {
      await t.tap(find.textContaining('客户（').first);
      await _pumpFor(t, const Duration(seconds: 4));
      await _shot(t, '05-客户欠款');
      await _back(t);
    }

    // ⑥ 报表中心
    await t.tap(find.text('我的').last);
    await _pumpFor(t, const Duration(seconds: 2));
    if (await _waitFor(t, find.text('报表中心'))) {
      await t.tap(find.text('报表中心'));
      await _pumpFor(t, const Duration(seconds: 5));
      await _shot(t, '06-报表中心');
    }
    // ignore: avoid_print
    print('SHOT:DONE');
    await _pumpFor(t, const Duration(seconds: 2));
  });
}
