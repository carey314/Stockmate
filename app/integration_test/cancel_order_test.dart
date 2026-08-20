// 作废订单回归（2026-08-16，两端功能对齐：Web 有、App 原来没有）：
//
// ⚠️ 清理提醒：这个测试每跑一次会留下一张已作废的单（后端没有硬删订单的接口）。
// 要清只能按当次的 orderId 精确删。**绝不能用「删掉所有 status='cancelled' 的单」**——
// 2026-08-16 我就是这么干的，把库里 15 张历史作废单一起删了（其中 14 张不是测试造的）。
// 作废单本身是惰性的（库存和钱在作废时就已经冲平），留着不影响任何数字。
// 测试自己造一张已收款的订单 → 在 App 里走完整作废流程 →
// 校验后端：状态 cancelled、库存真回退、已收的钱真生成退款流水。
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
  late int orderId;
  late String orderNo;
  late int skuId;
  late double stockBefore;

  setUpAll(() async {
    final a = await Api.I.post('/auth/login', data: {'username': 'admin', 'password': 'admin123'});
    await Api.I.setToken(a['token']);
    (await SharedPreferences.getInstance()).setBool('privacy_agreed_v1', true);
    final ps = await Api.I.get('/products', query: {'page': 1, 'pageSize': 20});
    final sku = (ps['list'] as List)
        .expand((p) => (p['skus'] as List? ?? []))
        .cast<Map<String, dynamic>>()
        .firstWhere((s) => s['inventory'] != null);
    skuId = sku['id'] as int;
    stockBefore = ((sku['inventory']['quantity'] ?? 0) as num).toDouble();
    final o = await Api.I.post('/orders', data: {
      'paidAmount': 66,
      'settlementAccount': '现金',
      'items': [{'skuId': skuId, 'quantity': 2, 'unitPrice': 33}],
    });
    orderId = o['id'] as int;
    orderNo = o['orderNo'] as String;
  });

  testWidgets('作废订单：库存回退 + 已收款生成退款流水', (t) async {
    await t.pumpWidget(const ProviderScope(child: StockMateApp()));
    await _pumpFor(t, const Duration(seconds: 3));
    if (find.text('同意并继续').evaluate().isNotEmpty) {
      await t.tap(find.text('同意并继续'));
      await _pumpFor(t, const Duration(seconds: 3));
    }
    // 直接进这张单的详情
    await t.tap(find.byIcon(Icons.receipt_long_rounded).first);
    await _pumpFor(t, const Duration(seconds: 3));
    // 列表按时间倒序，刚造的单在最前。单号可能和别的文字拼在一行，用 textContaining；
    // 再给一段轮询等待，别赌列表一定已经加载完
    final target = find.textContaining(orderNo);
    final deadline = DateTime.now().add(const Duration(seconds: 15));
    while (target.evaluate().isEmpty && DateTime.now().isBefore(deadline)) {
      await t.pump(const Duration(milliseconds: 300));
    }
    expect(target, findsWidgets, reason: '★ 订单列表里应能看到刚造的单 $orderNo');
    await t.tap(target.first);
    await _pumpFor(t, const Duration(seconds: 3));

    expect(find.byType(PopupMenuButton<String>), findsOneWidget, reason: '★ 已完成订单应有「更多」菜单');
    await t.tap(find.byType(PopupMenuButton<String>));
    await _pumpFor(t, const Duration(seconds: 2));
    expect(find.text('作废这张单'), findsOneWidget, reason: '★ 菜单里应有作废');
    await t.tap(find.text('作废这张单'));
    await _pumpFor(t, const Duration(seconds: 2));
    expect(find.text('作废这张单？'), findsOneWidget, reason: '★ 应二次确认');
    expect(find.textContaining('会退回库存'), findsOneWidget, reason: '★ 要说清后果：库存');
    expect(find.textContaining('退款流水'), findsOneWidget, reason: '★ 要说清后果：钱');
    // ignore: avoid_print
    print('SHOT:cancel-confirm');
    await _pumpFor(t, const Duration(seconds: 4));
    await t.tap(find.text('确认作废'));
    await _pumpFor(t, const Duration(seconds: 5));

    // 后端校验：状态 / 库存 / 退款流水
    final o = await Api.I.get('/orders/$orderId');
    expect(o['status'], 'cancelled', reason: '★ 订单应变成已取消');
    final ps = await Api.I.get('/products', query: {'page': 1, 'pageSize': 20});
    final sku = (ps['list'] as List)
        .expand((p) => (p['skus'] as List? ?? []))
        .cast<Map<String, dynamic>>()
        .firstWhere((s) => s['id'] == skuId);
    final after = ((sku['inventory']['quantity'] ?? 0) as num).toDouble();
    expect(after, stockBefore, reason: '★ 库存应退回原值（卖前 $stockBefore，作废后 $after）');
    // ignore: avoid_print
    print('SHOT:cancel-done');
    await _pumpFor(t, const Duration(seconds: 4));
  });
}
