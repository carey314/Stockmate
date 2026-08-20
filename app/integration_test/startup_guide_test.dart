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

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    // 自给自足：没有这个空账号就现注册一个（新店必须是真空的，这正是被测行为）
    Map<String, dynamic> auth;
    try {
      auth = await Api.I.post('/auth/register',
          data: {'username': 'newbie', 'password': 'newbie123', 'realName': '新手小店'});
    } catch (_) {
      auth = await Api.I.post('/auth/login', data: {'username': 'newbie', 'password': 'newbie123'});
    }
    await Api.I.setToken(auth['token']);
    (await SharedPreferences.getInstance()).setBool('privacy_agreed_v1', true);
  });
  testWidgets('新用户首页出现三步开工引导，且新店没有预填品类', (t) async {
    await t.pumpWidget(const ProviderScope(child: StockMateApp()));
    await _pumpFor(t, const Duration(seconds: 3));
    if (find.text('同意并继续').evaluate().isNotEmpty) {
      await t.tap(find.text('同意并继续'));
      await _pumpFor(t, const Duration(seconds: 3));
    }
    await _pumpFor(t, const Duration(seconds: 5));
    expect(find.text('三步开工'), findsOneWidget, reason: '新用户应看到引导卡');
    expect(find.text('花 1 分钟配成你这行的样子'), findsOneWidget);
    // ignore: avoid_print
    print('SHOT:guide-home');
    await _pumpFor(t, const Duration(seconds: 8));
    // 点第一步看行业选择
    await t.tap(find.text('告诉 AI 你做什么生意'));
    await _pumpFor(t, const Duration(seconds: 3));
    // ignore: avoid_print
    print('SHOT:guide-trade');
    expect(find.text('你是做什么生意的？'), findsOneWidget, reason: '第1步应问他的行业，而不是给固定预设');
    expect(find.text('水果店'), findsOneWidget, reason: '行业气泡（只是提示，自己打字优先）');
    await _pumpFor(t, const Duration(seconds: 3));
  });
}
