// 登录页视觉回归（2026-08-26 用户反馈"登录页很不协调"后重排）：
// 品牌区必须用真实 App 图标资源（不是代码画的星星）、副标题必须是人话、备案号在页脚。
// 顺带产出登录页截图（SHOT 标记），设计迭代时不用再和模拟器偏好缓存搏斗。
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stockmate/core/legal.dart';
import 'package:stockmate/core/theme.dart';
import 'package:stockmate/features/auth/login_screen.dart';

Future<void> _pumpFor(WidgetTester t, Duration d) async {
  final end = DateTime.now().add(d);
  while (DateTime.now().isBefore(end)) { await t.pump(const Duration(milliseconds: 200)); }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    SharedPreferences.setMockInitialValues({'privacy_agreed_v1': true});
  });

  testWidgets('登录页：真图标 + 人话副标题 + 备案号', (t) async {
    await t.pumpWidget(ProviderScope(child: MaterialApp(theme: buildTheme(), home: const LoginScreen())));
    await _pumpFor(t, const Duration(seconds: 2));

    expect(find.byType(Image), findsWidgets, reason: '★ 品牌区必须是真实图标资源');
    expect(find.text('智存'), findsOneWidget);
    expect(find.text('说一句话，账就记好了'), findsOneWidget, reason: '★ 副标题说人话');
    expect(find.textContaining('AI 原生'), findsNothing, reason: '★ 开发者黑话不进用户界面');
    expect(find.text(icpFiling), findsOneWidget, reason: '★ 备案号页脚展示');
    // ignore: avoid_print
    print('SHOT:login');
    await _pumpFor(t, const Duration(seconds: 5));
  });
}
