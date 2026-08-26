// 工信部要求备案号在 App 内显著位置展示——这个测试保证它真的渲染出来，
// 而不是只填了常量没接 UI（备案下来当天差点就只改常量完事）。
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stockmate/core/legal.dart';
import 'package:stockmate/features/auth/login_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  SharedPreferences.setMockInitialValues({});

  test('备案号常量已填且格式对', () {
    expect(icpFiling, isNotEmpty, reason: '★ 备案号不能是空串');
    expect(icpFiling, matches(RegExp(r'^[一-龥]ICP备\d+号-\d+A$')),
        reason: '★ App 备案号格式：省简称ICP备XXXX号-NA');
  });

  testWidgets('登录页显著位置展示备案号', (t) async {
    await t.pumpWidget(const ProviderScope(child: MaterialApp(home: LoginScreen())));
    await t.pump(const Duration(milliseconds: 300));
    expect(find.text(icpFiling), findsOneWidget, reason: '★ 登录页必须渲染备案号（工信部显著位置要求）');
  });
}
