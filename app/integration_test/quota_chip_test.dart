// 口述页剩余次数回归（2026-08-16）：显示「今天还剩 N 次」，用掉一次后数字要真的减。
// 目的不是限制，是让用户对额度有感知——将来上付费时不会觉得"突然被卡"。
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

int? _leftFromScreen(WidgetTester t) {
  for (final w in t.widgetList<Text>(find.byType(Text))) {
    final m = RegExp(r'今天还剩 (\d+) 次').firstMatch(w.data ?? '');
    if (m != null) return int.parse(m.group(1)!);
  }
  return null;
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    final a = await Api.I.post('/auth/login', data: {'username': 'admin', 'password': 'admin123'});
    await Api.I.setToken(a['token']);
    (await SharedPreferences.getInstance()).setBool('privacy_agreed_v1', true);
  });

  testWidgets('口述页显示剩余次数，且用掉一次后真的减 1', (t) async {
    await t.pumpWidget(const ProviderScope(child: StockMateApp()));
    await _pumpFor(t, const Duration(seconds: 3));
    if (find.text('同意并继续').evaluate().isNotEmpty) {
      await t.tap(find.text('同意并继续'));
      await _pumpFor(t, const Duration(seconds: 3));
    }
    await t.tap(find.byIcon(Icons.mic_rounded).first);
    await _pumpFor(t, const Duration(seconds: 4));

    final before = _leftFromScreen(t);
    expect(before, isNotNull, reason: '★ 口述页应显示「今天还剩 N 次」');
    // ignore: avoid_print
    print('SHOT:quota-before');
    await _pumpFor(t, const Duration(seconds: 4));

    // 真调一次 AI，额度应该少 1
    await t.enterText(find.byType(TextField).first, '卖了两瓶雪花啤酒收了8块');
    await _pumpFor(t, const Duration(seconds: 2));
    await t.tap(find.textContaining('AI 解析').first);
    await _pumpFor(t, const Duration(seconds: 22));

    final after = _leftFromScreen(t);
    expect(after, isNotNull, reason: '★ 解析后仍应显示剩余次数');
    expect(after, before! - 1, reason: '★ 用掉一次应减 1（前 $before → 后 $after）');
    // ignore: avoid_print
    print('SHOT:quota-after');
    await _pumpFor(t, const Duration(seconds: 5));
  });
}
