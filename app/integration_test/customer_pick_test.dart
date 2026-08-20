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
  int? debtOrderId; // 测试自己造的挂账单，跑完撤掉

  setUpAll(() async {
    final a = await Api.I.post('/auth/login', data: {'username': 'admin', 'password': 'admin123'});
    await Api.I.setToken(a['token']);
    (await SharedPreferences.getInstance()).setBool('privacy_agreed_v1', true);
    // 「欠款徽标」断言需要有人真欠钱。测试自己造前提，别依赖库里恰好有脏数据。
    final ps = await Api.I.get('/products', query: {'page': 1, 'pageSize': 20});
    final sku = (ps['list'] as List)
        .expand((p) => (p['skus'] as List? ?? []))
        .cast<Map<String, dynamic>>()
        .firstOrNull;
    if (sku != null) {
      final o = await Api.I.post('/orders', data: {
        'customerId': 1,
        'paidAmount': 0,
        'settlementAccount': '挂账',
        'items': [
          {'skuId': sku['id'], 'quantity': 5, 'unitPrice': 88}
        ],
      });
      debtOrderId = o['id'] as int?;
    }
  });

  tearDownAll(() async {
    // 用完即删：撤掉挂账单，欠款归零，不给后面的测试和人工试用留脏数据
    if (debtOrderId != null) {
      try {
        await Api.I.put('/orders/$debtOrderId/cancel', data: {});
      } catch (_) {}
    }
  });
  testWidgets('销售开单：点客户卡片能开选择器、能看到老客户和新建入口', (t) async {
    await t.pumpWidget(const ProviderScope(child: StockMateApp()));
    await _pumpFor(t, const Duration(seconds: 3));
    if (find.text('同意并继续').evaluate().isNotEmpty) {
      await t.tap(find.text('同意并继续'));
      await _pumpFor(t, const Duration(seconds: 3));
    }
    // 底栏中间大按钮 = 开单 → 订单列表 FAB
    await t.tap(find.byIcon(Icons.receipt_long_rounded).first);
    await _pumpFor(t, const Duration(seconds: 3));
    await t.tap(find.byIcon(Icons.add_rounded).first);
    await _pumpFor(t, const Duration(seconds: 3));
    expect(find.text('散客（不记名）'), findsWidgets, reason: '开单页应有客户卡片');
    // ignore: avoid_print
    print('SHOT:cust-before');
    await _pumpFor(t, const Duration(seconds: 3));

    // 关键：点卡片的**空白处**（文字右边、箭头左边），而不是点文字。
    // 用户在真机上不会精准点文字，随手戳卡片中间/右边是常态。
    final card = find.ancestor(of: find.text('散客（不记名）').first, matching: find.byType(SoftCard)).first;
    final rect = t.getRect(card);
    await t.tapAt(Offset(rect.left + rect.width * 0.75, rect.center.dy));
    await _pumpFor(t, const Duration(seconds: 4));

    expect(find.text('卖给谁？'), findsOneWidget, reason: '★ 客户选择弹窗应打开');
    expect(find.text('新建客户'), findsOneWidget, reason: '★ 应有新建客户入口');
    expect(find.text('老王烟酒行'), findsOneWidget, reason: '★ 应列出已有客户');
    expect(find.textContaining('老客户 ·'), findsOneWidget, reason: '★ 应有分组小标题');
    expect(find.textContaining('欠 ¥'), findsWidgets, reason: '★ 挂账客户应显示欠款');
    expect(find.textContaining('笔未结'), findsWidgets, reason: '★ 应显示未结笔数');
    // ignore: avoid_print
    print('SHOT:cust-sheet');
    await _pumpFor(t, const Duration(seconds: 5));

    // 选中老王 → 再打开一次，应该被高亮标出来
    await t.tap(find.text('老王烟酒行'));
    await _pumpFor(t, const Duration(seconds: 3));
    final card2 = find.ancestor(of: find.text('老王烟酒行').first, matching: find.byType(SoftCard)).first;
    final r2 = t.getRect(card2);
    await t.tapAt(Offset(r2.left + r2.width * 0.75, r2.center.dy));
    await _pumpFor(t, const Duration(seconds: 4));
    expect(find.byIcon(Icons.check_circle_rounded), findsOneWidget, reason: '★ 已选中的客户应有勾标记');
    // ignore: avoid_print
    print('SHOT:cust-selected');
    await _pumpFor(t, const Duration(seconds: 5));
  });
}
