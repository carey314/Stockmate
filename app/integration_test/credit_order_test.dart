// 挂账语义回归（2026-08-21，真人测试抓出的钱账 bug）：
// 之前点「挂账」只改标签不动实收，实收空=默认全款 → 系统记成"全款收讫，方式叫挂账"，
// 欠款为 0、资金流水多一笔不存在的收入，还绕过了服务端"散客必须结清"的闸。
//
// 断言四件事：
//   1. 点「挂账」chip → 实收自动清零（「挂账 ¥X」黄字出现）
//   2. 散客 + 挂账 → 出现"散客不能挂账"的硬提醒（服务端本来就会 400，UI 提前说）
//   3. 选记名客户后提交 → 落库 paidAmount=0，欠款=全额
//   4. 新单 id 必须大于提交前的最新 id——上一版按"最新一单"捕获，提交失败时
//      抓到的是别人的旧单还把它作废了。教训：先记基线，只认比基线新的。
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

Future<int> _latestOrderId() async {
  final r = await Api.I.get('/orders?page=1&pageSize=1');
  final list = r['list'] as List;
  return list.isEmpty ? 0 : (list.first['id'] as int);
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  int? createdOrderId; // 只作废确证是本测试开出的单

  setUpAll(() async {
    final a = await Api.I.post('/auth/login', data: {'username': 'admin', 'password': 'admin123'});
    await Api.I.setToken(a['token']);
    final sp = await SharedPreferences.getInstance();
    sp.setBool('privacy_agreed_v1', true);
    sp.setBool('ln_prompted', true); // 跳过首单收摊提醒弹窗，专注挂账链路
    sp.remove('sale_draft_v1'); // 清草稿，防上次残留污染购物车
  });

  tearDownAll(() async {
    if (createdOrderId != null) {
      try {
        await Api.I.put('/orders/$createdOrderId/cancel');
        // ignore: avoid_print
        print('✓ 已作废本测试开的单 #$createdOrderId（库存/欠款已回冲）');
      } catch (e) {
        // ignore: avoid_print
        print('⚠ 作废失败，需手动处理 #$createdOrderId：$e');
      }
    }
  });

  testWidgets('挂账开单：实收自动清零、散客被拦、记名客户落库欠全额', (t) async {
    await t.pumpWidget(const ProviderScope(child: StockMateApp()));
    await _pumpFor(t, const Duration(seconds: 3));
    if (find.text('同意并继续').evaluate().isNotEmpty) {
      await t.tap(find.text('同意并继续'));
      await _pumpFor(t, const Duration(seconds: 3));
    }

    // 底栏中间大按钮=开单 → FAB 开单
    await t.tap(find.byIcon(Icons.receipt_long_rounded).first);
    await _pumpFor(t, const Duration(seconds: 2));
    await t.tap(find.text('开单'));
    await _pumpFor(t, const Duration(seconds: 2));

    // 加一个货：搜"芹菜"点第一行
    await t.tap(find.text('添加商品'));
    await _pumpFor(t, const Duration(seconds: 2));
    await t.enterText(find.widgetWithText(TextField, '搜商品名 / 条码 / 规格').first, '芹菜');
    await _pumpFor(t, const Duration(seconds: 2));
    await t.tap(find.textContaining('芹菜馄饨').last);
    await _pumpFor(t, const Duration(seconds: 2));
    if (find.text('添加商品').evaluate().isEmpty) {
      await t.tap(find.textContaining('芹菜馄饨').last);
      await _pumpFor(t, const Duration(seconds: 2));
    }
    expect(find.text('添加商品'), findsOneWidget, reason: '★ 应已回到开单页且购物车有货');

    // ① 散客状态下点「挂账」→ 实收清零 + 硬提醒出现
    await t.ensureVisible(find.text('挂账'));
    await t.tap(find.text('挂账'));
    await _pumpFor(t, const Duration(seconds: 1));
    expect(find.textContaining('挂账 ¥'), findsOneWidget,
        reason: '★ 选挂账后必须显示挂账金额（证明实收被清零）');
    expect(find.textContaining('散客不能挂账'), findsOneWidget,
        reason: '★ 散客挂账要提前拦住（服务端会 400，别让人填完才被打回）');

    // ② 选记名客户「老王烟酒行」再提交
    await t.ensureVisible(find.textContaining('散客（不记名）').first);
    await t.tap(find.textContaining('散客（不记名）').first);
    await _pumpFor(t, const Duration(seconds: 2));
    await t.tap(find.text('老王烟酒行').last);
    await _pumpFor(t, const Duration(seconds: 2));
    expect(find.textContaining('散客不能挂账'), findsNothing,
        reason: '★ 选了客户后提醒要消失');

    final baseline = await _latestOrderId(); // 提交前基线：只认比它新的单

    await t.ensureVisible(find.text('提交订单'));
    await t.tap(find.text('提交订单'));
    await _pumpFor(t, const Duration(seconds: 4));

    final latest = await Api.I.get('/orders?page=1&pageSize=1');
    final o = (latest['list'] as List).first as Map<String, dynamic>;
    expect(o['id'] as int, greaterThan(baseline),
        reason: '★ 没有比基线新的单 = 提交根本没成功，别拿别人的旧单当结果');
    createdOrderId = o['id'] as int;

    final actual = (o['actualAmount'] as num).toDouble();
    final paid = (o['paidAmount'] as num).toDouble();
    expect(o['settlementAccount'], '挂账');
    expect(paid, 0, reason: '★ 挂账单实收必须是 0，落库 $paid/$actual 就是钱账错误');
    expect(actual, greaterThan(0));
    expect(o['customer']?['name'], '老王烟酒行');
    // ignore: avoid_print
    print('✓ 挂账单 ${o['orderNo']}：应收 $actual / 实收 $paid（全额欠款，挂在老王烟酒行名下）');
  });
}
