// 庆祝层视觉走查：IAP_PREVIEW 模式下点「开通专业版」会播放解锁彩蛋（不真开通），
// 在礼花最盛的时刻打 SHOT 标记截图——设计迭代不用真付款。
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stockmate/core/api.dart';
import 'package:stockmate/main.dart';

Future<void> _pumpFor(WidgetTester t, Duration d) async {
  final end = DateTime.now().add(d);
  while (DateTime.now().isBefore(end)) { await t.pump(const Duration(milliseconds: 100)); }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    final a = await Api.I.post('/auth/login', data: {'username': 'admin', 'password': 'admin123'});
    await Api.I.setToken(a['token']);
    final sp = await SharedPreferences.getInstance();
    sp.setBool('privacy_agreed_v1', true);
    sp.setBool('ln_prompted', true);
  });

  testWidgets('订阅解锁彩蛋（预览模式）', (t) async {
    if (!const bool.fromEnvironment('IAP_PREVIEW')) {
      markTestSkipped('需要 --dart-define=IAP_PREVIEW=true（无预览商品就没有开通按钮可点）。'
          '套件默认不带此参数，跳过属预期；要跑就单独带参数跑。');
      return;
    }
    await t.pumpWidget(const ProviderScope(child: StockMateApp()));
    await _pumpFor(t, const Duration(seconds: 3));
    if (find.text('同意并继续').evaluate().isNotEmpty) {
      await t.tap(find.text('同意并继续'));
      await _pumpFor(t, const Duration(seconds: 3));
    }
    await t.tap(find.text('我的').last);
    await _pumpFor(t, const Duration(seconds: 2));
    await t.tap(find.text('专业版'));
    await _pumpFor(t, const Duration(seconds: 4));

    await t.ensureVisible(find.textContaining('开通专业版'));
    await t.tap(find.textContaining('开通专业版'));
    await _pumpFor(t, const Duration(milliseconds: 700)); // 礼花炸开的中段
    expect(find.text('专业版已解锁'), findsOneWidget);
    expect(find.text('开始用'), findsOneWidget, reason: '★ 付费彩蛋必须按钮收场');
    // ignore: avoid_print
    print('SHOT:celebrate');
    await _pumpFor(t, const Duration(seconds: 5));
    await t.tap(find.text('开始用'));
    await _pumpFor(t, const Duration(seconds: 1));
    expect(find.text('专业版已解锁'), findsNothing);
  });
}
