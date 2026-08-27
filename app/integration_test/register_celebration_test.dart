// 注册开张彩蛋（2026-08-27）：真实注册流程走 UI——
// 庆祝层挂根导航，必须在「登录页→首页」路由切换之上活着，自动收场后落在三步开工。
// 自给自足：现场注册一个时间戳账号，测完用 App 自己的删号接口清掉，不留残渣。
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stockmate/core/api.dart';
import 'package:stockmate/main.dart';

Future<void> _pumpFor(WidgetTester t, Duration d) async {
  final end = DateTime.now().add(d);
  while (DateTime.now().isBefore(end)) { await t.pump(const Duration(milliseconds: 150)); }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  bool registered = false;

  setUpAll(() async {
    final sp = await SharedPreferences.getInstance();
    sp.setBool('privacy_agreed_v1', true);
    // setToken('') 存的是空串，hasToken 判 != null 仍算"已登录"——必须传 null 真正清掉
    await Api.I.setToken(null);
    sp.remove('token'); // 双保险：上一个测试留在容器里的持久化 token 也清干净
  });

  tearDownAll(() async {
    // 只删本测试注册的号（token 还在 Api 里）；删号即清全店数据
    if (registered) {
      try {
        await Api.I.post('/auth/delete-account');
        // ignore: avoid_print
        print('✓ 测试账号已自删');
      } catch (e) {
        // ignore: avoid_print
        print('⚠ 测试账号自删失败，需手动清理：$e');
      }
    }
  });

  testWidgets('注册成功：开张大吉彩蛋盖在首页之上，自动收场后落在三步开工', (t) async {
    await t.pumpWidget(const ProviderScope(child: StockMateApp()));
    await _pumpFor(t, const Duration(seconds: 3));
    if (find.text('同意并继续').evaluate().isNotEmpty) {
      await t.tap(find.text('同意并继续'));
      await _pumpFor(t, const Duration(seconds: 2));
    }

    // 切到注册模式
    await t.tap(find.text('没有账号？注册一个'));
    await _pumpFor(t, const Duration(seconds: 1));

    final uname = 'cele${DateTime.now().millisecondsSinceEpoch % 100000000}';
    await t.enterText(find.widgetWithText(TextField, '用户名').first, uname);
    await t.enterText(find.widgetWithText(TextField, '密码（至少 6 位）').first, 'cele123456');
    // 注册模式的确认密码和店名（按 label 找，容错找不到就跳过店名）
    await t.enterText(find.widgetWithText(TextField, '确认密码').first, 'cele123456');
    await t.enterText(find.widgetWithText(TextField, '店名/称呼（选填）').first, '彩蛋测试店');
    await _pumpFor(t, const Duration(milliseconds: 400));

    await t.tap(find.text('注册并开始使用'));
    registered = true;

    // ① 彩蛋 2.4s 就自动收场——必须小步轮询捕捉，傻等一大段它出现过又走了
    var seen = false;
    for (var i = 0; i < 40 && !seen; i++) {
      await t.pump(const Duration(milliseconds: 100));
      seen = find.text('开张大吉').evaluate().isNotEmpty;
    }
    expect(seen, isTrue, reason: '★ 注册成功必须有开张仪式（4 秒内未出现）');
    expect(find.textContaining('第一笔账就记好了'), findsOneWidget);

    // ② 自动收场（2.4s）后落在首页，三步开工接力
    await _pumpFor(t, const Duration(seconds: 4));
    expect(find.text('开张大吉'), findsNothing, reason: '★ 彩蛋必须自动消失，不挡首页');
    expect(find.text('三步开工'), findsOneWidget, reason: '★ 收场后新用户看到的是三步开工引导');
  });
}
