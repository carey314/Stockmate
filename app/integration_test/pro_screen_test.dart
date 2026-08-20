// 订阅页回归（2026-08-16）：苹果 3.1.2 对订阅页有硬性要求，缺一样就拒。
// 模拟器拿不到真实 IAP 沙盒（商品会查不到），所以这里断言的是**页面必备元素**，
// 真实购买链路要在 TestFlight + 沙盒账号上验。
//
// ⚠️ ListView 是懒建的：屏幕外的 widget 压根不会 build，find 找不到。
//    所以必须**滚到底再断言底部元素**，否则页面一变高，测试就红（或者更糟——
//    findsNothing 的反向断言因为 widget 没建而"通过"，等于没验）。
//    反导流红线因此在顶部和底部各查一次。
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

/// 反导流红线：页面上任何位置都不能出现站外购买引导。
void _noExternalPurchase(String where) {
  for (final banned in ['网页购买', '官网购买', '微信支付', '支付宝', '扫码支付', '联系客服购买']) {
    expect(find.textContaining(banned), findsNothing,
        reason: '★ $where 不得出现站外购买引导「$banned」');
  }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    final a = await Api.I.post('/auth/login', data: {'username': 'admin', 'password': 'admin123'});
    await Api.I.setToken(a['token']);
    (await SharedPreferences.getInstance()).setBool('privacy_agreed_v1', true);
  });

  testWidgets('订阅页：苹果要求的必备元素齐全，且无站外购买引导', (t) async {
    await t.pumpWidget(const ProviderScope(child: StockMateApp()));
    await _pumpFor(t, const Duration(seconds: 3));
    if (find.text('同意并继续').evaluate().isNotEmpty) {
      await t.tap(find.text('同意并继续'));
      await _pumpFor(t, const Duration(seconds: 3));
    }
    await t.tap(find.text('我的').last);
    await _pumpFor(t, const Duration(seconds: 2));
    await t.tap(find.text('专业版'));
    await _pumpFor(t, const Duration(seconds: 6));

    // ===== 顶部：hero 说「省了多少时间」，不说「够不够用」 =====
    expect(find.text('AI 帮你省了'), findsOneWidget, reason: '★ hero 用省下的时间说话');
    expect(find.textContaining('按手动开一单约'), findsOneWidget,
        reason: '★ 估算系数必须标注来源，不能把估算值伪装成实测值');
    expect(find.textContaining('还够用'), findsNothing,
        reason: '★ 订阅页最大的版面不能用来说"你不需要买"');
    _noExternalPurchase('页面顶部');

    // 带 IAP_PREVIEW=true 跑时有假商品，可以顺带验「选套餐 → 按钮跟着变」这条交互。
    // 不带这个参数时模拟器查不到商品，跳过即可。
    // ⚠️ 必须写 =true，写 =1 会被 bool.fromEnvironment 判成 false，整块静默跳过。
    if (const bool.fromEnvironment('IAP_PREVIEW')) {
      expect(find.textContaining('开通专业版 · ¥168.00 / 年'), findsOneWidget,
          reason: '★ 默认选年付，按钮上要写清买的是哪个、多少钱');
      expect(find.text('折合 ¥14 / 月'), findsOneWidget, reason: '★ 年付要给出折合每月');
      // 点月付卡 → 按钮金额必须跟着换，否则用户会按下去才发现买错了
      await t.tap(find.text('按月'));
      await _pumpFor(t, const Duration(seconds: 1));
      expect(find.textContaining('开通专业版 · ¥19.00 / 月'), findsOneWidget,
          reason: '★ 选月付后按钮必须变成月付价');
      await t.tap(find.text('按年'));
      await _pumpFor(t, const Duration(seconds: 1));
    }

    // 截图取的是页面顶部（首屏才是用户第一眼看到的东西）
    // ignore: avoid_print
    print('SHOT:pro');
    await _pumpFor(t, const Duration(seconds: 5));

    // ===== 滚到底：苹果要求的合规元素都在页尾 =====
    await t.dragUntilVisible(
      find.text('用户协议'), find.byType(ListView), const Offset(0, -250),
      maxIteration: 30,
    );
    await _pumpFor(t, const Duration(seconds: 1));

    expect(find.text('恢复购买'), findsOneWidget, reason: '★ 必须有恢复购买（换设备/重装要能拿回权益）');
    expect(find.textContaining('自动续期'), findsOneWidget, reason: '★ 必须说明自动续期规则');
    expect(find.textContaining('设置 → Apple 账户 → 订阅'), findsWidgets, reason: '★ 必须告诉用户去哪取消');
    expect(find.text('用户协议'), findsOneWidget, reason: '★ 必须有用户协议链接');
    expect(find.text('隐私政策'), findsOneWidget, reason: '★ 必须有隐私政策链接');
    expect(find.textContaining('永久免费'), findsWidgets, reason: '★ 免费承诺要写在订阅页上');
    _noExternalPurchase('页面底部');
  });
}
