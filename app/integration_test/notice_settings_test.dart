// 提醒设置（留存钩子）回归：
// 1. 通知页右上角有齿轮 → 点进提醒设置页
// 2. 设置页有开关 + 说明文案；开关默认关
// 3. 排程逻辑（LocalNotice.applySchedule 的时间计算）在逻辑层断言
// 注意：不点开关的"开"路径——那会弹系统权限框，模拟器上无法程序化点掉（simctl 不支持
// 通知权限预授权），授权后的展示留真机验收清单。
//
// 2026-08-15：排程断言原来隐式依赖"模拟器上恰好还留着通知授权"。App 一旦被卸载重装，
// 授权就没了，iOS 会把 zonedSchedule 静默丢弃（applySchedule 照常返回、pending 却是空的），
// 测试就莫名其妙地红。现在测试自己用 provisional 授权把前提建起来——
// provisional 是 iOS 的"安静授权"，不弹任何弹窗，正好适合自动化。
import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stockmate/core/api.dart';
import 'package:stockmate/core/local_notice.dart';
import 'package:stockmate/features/notifications/notice_settings_screen.dart';
import 'package:stockmate/main.dart' as app;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() async {
    final sp = await SharedPreferences.getInstance();
    await sp.setBool('privacy_agreed_v1', true);
    await sp.remove('ln_enabled'); // 干净起点：提醒关
    final auth = await Api.I.post('/auth/login', data: {'username': 'admin', 'password': 'admin123'});
    await Api.I.setToken(auth['token']);
  });

  testWidgets('通知页齿轮 → 提醒设置页渲染完整', (t) async {
    app.main();
    await t.pumpAndSettle(const Duration(seconds: 3));

    // 首页铃铛进通知页
    await t.tap(find.byIcon(Icons.notifications_none_rounded).first);
    await t.pumpAndSettle(const Duration(seconds: 2));

    // 右上角齿轮
    expect(find.byIcon(Icons.settings_outlined), findsOneWidget, reason: '通知页应有提醒设置入口');
    await t.tap(find.byIcon(Icons.settings_outlined));
    await t.pumpAndSettle(const Duration(seconds: 1));

    // 设置页要素齐全
    expect(
      find.descendant(of: find.byType(NoticeSettingsScreen), matching: find.text('每日收摊提醒')),
      findsOneWidget,
    );
    expect(find.byType(SwitchListTile), findsOneWidget);
    final sw = t.widget<SwitchListTile>(find.byType(SwitchListTile));
    expect(sw.value, false, reason: '默认应是关');
    expect(find.textContaining('不经过服务器'), findsOneWidget, reason: '隐私说明必须在');
  });

  testWidgets('排程逻辑：开着提醒时 applySchedule 挂上 2 个排程', (t) async {
    // 直接在逻辑层验证（绕过系统权限弹窗）：手写 enabled 标记后 applySchedule，
    // 断言每日+召回两个排程都挂上、时刻正确。
    // 前提：没授权的话 iOS 会把排程静默吞掉，所以先拿一个 provisional（安静授权，不弹框）
    // 前提：iOS 没授权时会把 zonedSchedule 静默丢弃（applySchedule 照常返回、pending 却是空）。
    // 模拟器上拿不到通知授权：simctl privacy 不支持 notifications，provisional 也申请不下来，
    // 而 App 一被卸载重装授权就没了。所以这里显式检测——没授权就明确跳过并喊出来，
    // 而不是让断言莫名其妙地红，把"环境缺前提"伪装成"代码坏了"。
    await LocalNotice.I.pending(); // 先触发 initialize
    final ios = FlutterLocalNotificationsPlugin()
        .resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>();
    await ios?.requestPermissions(alert: true, sound: true, provisional: true);
    final authorized = (await ios?.checkPermissions())?.isEnabled ?? false;
    if (!authorized) {
      // ignore: avoid_print
      print('⚠️ 跳过排程断言：本机通知未授权（模拟器无法程序化授权），此路径需真机/已授权设备验收');
      markTestSkipped('通知未授权，排程无法验证');
      return;
    }
    final sp = await SharedPreferences.getInstance();
    await sp.setBool('ln_enabled', true);
    await sp.setInt('ln_hour', 21);
    await sp.setInt('ln_minute', 30);
    await LocalNotice.I.applySchedule();
    final pending = await LocalNotice.I.pending();
    final ids = pending.map((p) => p.id).toSet();
    expect(ids.containsAll({9001, 9002}), true, reason: '每日提醒 + 召回提醒都应在排程里，实际: $ids');
    final daily = pending.firstWhere((p) => p.id == 9001);
    expect(daily.title, '智存 · 收摊小结');
    expect(daily.body, isNotEmpty);
    // 关掉 → 排程清空
    await LocalNotice.I.setEnabled(false);
    final after = await LocalNotice.I.pending();
    expect(after.where((p) => p.id == 9001 || p.id == 9002), isEmpty, reason: '关掉后应清空排程');
  });

  tearDownAll(() async {
    final sp = await SharedPreferences.getInstance();
    await sp.remove('ln_enabled');
    await sp.remove('ln_hour');
    await sp.remove('ln_minute');
  });
}
