// 端到端集成测试：真实 Flutter 引擎里真手点，覆盖两条主链路——
//   A. 散客开单：开单tab → FAB → 加商品 → 提交 → 开单成功
//   B. 收欠款：API 造一张挂账单 → 订单列表点进去 → 收款按钮 → 确认 → 结清
// 这两条正是之前只能"截图看渲染"没法验证交互的缩水项。
//
// 跑法（后端须在 3100）：
//   flutter test integration_test/core_flows_test.dart -d <simulator-udid>
// 测试自己造的数据用完即删（tearDownAll 直接调后端清理）。
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stockmate/core/api.dart';
import 'package:stockmate/main.dart';

Future<void> _settle(WidgetTester t, [int ms = 400]) async {
  await t.pumpAndSettle(const Duration(milliseconds: 100));
  await t.pump(Duration(milliseconds: ms));
  await t.pumpAndSettle(const Duration(milliseconds: 100));
}

/// 等某个 finder 出现（网络加载的页面 pumpAndSettle 不够）
Future<void> _waitFor(WidgetTester t, Finder f, {int tries = 40}) async {
  for (var i = 0; i < tries; i++) {
    await t.pump(const Duration(milliseconds: 250));
    if (f.evaluate().isNotEmpty) return;
  }
  throw TestFailure('等不到控件: $f');
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  final createdOrderIds = <int>[];
  int? unpaidOrderId;
  String? unpaidOrderNo;

  setUpAll(() async {
    // 预写隐私同意标记，绕过首启同意页（同意页本身由 widget 测试覆盖）
    (await SharedPreferences.getInstance()).setBool('privacy_agreed_v1', true);
    // 登录 + 预置一张挂账单（收款流程的被测对象）
    final auth = await Api.I.post('/auth/login', data: {'username': 'admin', 'password': 'admin123'});
    await Api.I.setToken(auth['token']);
    final custs = await Api.I.get('/customers', query: {'pageSize': 10});
    final named = (custs['list'] as List).firstWhere((c) => c['name'] != '散客');
    final skuList = await Api.I.get('/products', query: {'keyword': '芹菜馄饨'});
    final sku = (skuList['list'] as List).first['skus'][0];
    final order = await Api.I.post('/orders', data: {
      'customerId': named['id'],
      'paidAmount': 0,
      'settlementAccount': '挂账',
      'notes': '集成测试-收款用例',
      'items': [
        {'skuId': sku['id'], 'quantity': 1, 'unitPrice': 15}
      ],
    });
    unpaidOrderId = order['id'];
    unpaidOrderNo = order['orderNo'];
    createdOrderIds.add(order['id']);
  });

  tearDownAll(() async {
    // 清理：还原库存、删单据流水（测试数据用完即删）
    for (final id in createdOrderIds) {
      try {
        await Api.I.post('/__test/cleanup-order/$id');
      } catch (_) {/* 走兜底脚本 */}
    }
  });

  testWidgets('A. 散客开单：加商品→提交→开单成功', (t) async {
    await t.pumpWidget(const ProviderScope(child: StockMateApp()));
    await _settle(t, 1200);

    // 底栏中间大按钮 = 开单（首页里这个图标唯一）
    await t.tap(find.byIcon(Icons.receipt_long_rounded).first);
    await _settle(t);

    // 订单列表 FAB「开单」
    await _waitFor(t, find.byIcon(Icons.add_rounded));
    await t.tap(find.byIcon(Icons.add_rounded).first);
    await _settle(t);

    // 默认散客——不选客户就能开，这正是 P0-3 修的东西
    expect(find.textContaining('散客（不记名）'), findsOneWidget, reason: '开单页应默认散客');

    // 加商品（先确认选货弹窗真的弹出来了）
    await t.ensureVisible(find.text('添加商品'));
    await t.tap(find.text('添加商品'));
    await _waitFor(t, find.text('选择商品'));
    // ListView 懒加载：目标商品可能在视口外，用弹窗里的搜索框定位（顺带验证搜索链路）
    final sheetSearch = find.descendant(of: find.byType(BottomSheet), matching: find.byType(TextField)).first;
    await t.enterText(sheetSearch, '芹菜');
    await _settle(t, 500);
    await _waitFor(t, find.text('芹菜馄饨'));
    await t.tap(find.text('芹菜馄饨').last);
    await _settle(t, 800);

    // 购物车有行了 → 提交
    await _waitFor(t, find.text('提交订单'));
    await t.ensureVisible(find.text('提交订单'));
    await t.tap(find.text('提交订单'));
    await _settle(t, 1500);

    // 成功提示（含负库存提示的变体也算成功）
    await _waitFor(t, find.textContaining('开单成功'));
    expect(find.textContaining('开单成功'), findsWidgets);

    // 记下这张单，teardown 清掉：拉最新一张
    final latest = await Api.I.get('/orders', query: {'pageSize': 1});
    createdOrderIds.add((latest['list'] as List).first['id'] as int);
  });

  testWidgets('B. 收欠款：订单列表→详情→收款→结清', (t) async {
    await t.pumpWidget(const ProviderScope(child: StockMateApp()));
    await _settle(t, 1200);

    await t.tap(find.byIcon(Icons.receipt_long_rounded).first);
    await _settle(t, 800);

    // 找到预置的挂账单（单号唯一）
    await _waitFor(t, find.textContaining(unpaidOrderNo!));
    await t.tap(find.textContaining(unpaidOrderNo!).first);
    await _settle(t, 1000);

    // 详情页应有整行主按钮「收款 ¥15」——这就是审查里"后端有接口 App 没按钮"那条
    await _waitFor(t, find.textContaining('收款 ¥'));
    await t.tap(find.textContaining('收款 ¥').first);
    await _settle(t, 600);

    // 收款面板：金额已预填欠款全额 → 直接确认
    await _waitFor(t, find.textContaining('确认收款'));
    await t.tap(find.textContaining('确认收款').first);
    await _settle(t, 1500);

    await _waitFor(t, find.textContaining('结清'));
    expect(find.textContaining('结清'), findsWidgets);

    // 数据面复核：这张单确实 0 欠款了
    final o = await Api.I.get('/orders/$unpaidOrderId');
    expect((o['unpaidAmount'] as num).toDouble(), 0);
  });
}
