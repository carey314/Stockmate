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
  testWidgets('删除账号已移出首屏，进「账号与安全」', (t) async {
    await t.pumpWidget(const ProviderScope(child: StockMateApp()));
    await _pumpFor(t, const Duration(seconds: 3));
    if (find.text('同意并继续').evaluate().isNotEmpty) {
      await t.tap(find.text('同意并继续'));
      await _pumpFor(t, const Duration(seconds: 3));
    }
    await t.tap(find.text('我的').last);
    await _pumpFor(t, const Duration(seconds: 3));
    // 滚到看见为止（固定距离会滚过头或不够）
    await t.scrollUntilVisible(find.text('退出登录'), 260, scrollable: find.byType(Scrollable).first);
    await _pumpFor(t, const Duration(seconds: 2));
    expect(find.text('删除账号'), findsNothing, reason: '「我的」首屏不该再有删除账号（挨着退出登录太容易误点）');
    expect(find.text('退出登录'), findsOneWidget);
    expect(find.text('账号与安全'), findsOneWidget, reason: '删号应该改从这里进');
    // ignore: avoid_print
    print('SHOT:profile-bottom');
    await _pumpFor(t, const Duration(seconds: 7));
    await t.tap(find.text('账号与安全'));
    await _pumpFor(t, const Duration(seconds: 3));
    expect(find.text('删除账号'), findsOneWidget, reason: '删除账号应在账号与安全页');
    expect(find.text('危险操作'), findsOneWidget);
    // ignore: avoid_print
    print('SHOT:account-page');
    await _pumpFor(t, const Duration(seconds: 7));
  });
}
