// 故障路径回归：客户接口挂掉时，开单页点客户卡片必须仍然弹窗，
// 且「散客」「新建客户」可用、列表区给明确错误+重试。
// 对应 2026-08-14 用户反馈"销售开单里没有客户选择、增加的功能"——
// 根因是当时的实现「先 await 客户列表成功才弹窗」且无 try/catch，一失败就是点了没反应。
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
  setUpAll(() async {
    final a = await Api.I.post('/auth/login', data: {'username': 'admin', 'password': 'admin123'});
    await Api.I.setToken(a['token']);
    (await SharedPreferences.getInstance()).setBool('privacy_agreed_v1', true);
  });
  testWidgets('客户接口500时：仍能弹窗、散客/新建可用、有错误提示和重试', (t) async {
    await t.pumpWidget(const ProviderScope(child: StockMateApp()));
    await _pumpFor(t, const Duration(seconds: 3));
    if (find.text('同意并继续').evaluate().isNotEmpty) {
      await t.tap(find.text('同意并继续'));
      await _pumpFor(t, const Duration(seconds: 3));
    }
    await t.tap(find.byIcon(Icons.receipt_long_rounded).first);
    await _pumpFor(t, const Duration(seconds: 3));
    await t.tap(find.byIcon(Icons.add_rounded).first);
    await _pumpFor(t, const Duration(seconds: 3));

    final card = find.ancestor(of: find.text('散客（不记名）').first, matching: find.byType(SoftCard)).first;
    final rect = t.getRect(card);
    await t.tapAt(Offset(rect.left + rect.width * 0.75, rect.center.dy));
    await _pumpFor(t, const Duration(seconds: 5));

    expect(find.text('卖给谁？'), findsOneWidget, reason: '★ 接口挂了也必须弹窗，不能点了没反应');
    expect(find.text('新建客户'), findsOneWidget, reason: '★ 新建客户不依赖网络，必须可用');
    expect(find.text('老客户列表没加载出来'), findsOneWidget, reason: '★ 失败要说人话，不能静默');
    expect(find.text('重试'), findsOneWidget, reason: '★ 要给重试');
    // ignore: avoid_print
    print('SHOT:custfail-sheet');
    await _pumpFor(t, const Duration(seconds: 6));
  });
}
