import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/data/latest.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

/// 留存钩子：本地通知（不依赖 APNs 证书 / 服务号资质，上架前就能上线）。
/// 两个提醒：
///  1. 每日收摊提醒（默认 21:00，可改时间/可关）——记账产品的生死线是"收摊时想起你"
///  2. 召回提醒（3 天没打开 App 时响一次）——每次打开 App 自动顺延，打开了就永远不响
///
/// 刻意不在 main.dart 初始化（懒加载）：没开通的用户零成本，也不在首启弹权限（HIG）。
/// 权限申请只发生在用户明确说"要提醒"之后（开单成功后的一次性引导 / 设置页开关）。
class LocalNotice {
  LocalNotice._();
  static final LocalNotice I = LocalNotice._();

  static const _kEnabled = 'ln_enabled';
  static const _kHour = 'ln_hour';
  static const _kMinute = 'ln_minute';
  static const _kPrompted = 'ln_prompted'; // 开单后引导只弹一次

  static const _idDaily = 9001;
  static const _idRecall = 9002;

  final _plugin = FlutterLocalNotificationsPlugin();
  bool _inited = false;

  Future<void> _ensureInit() async {
    if (_inited) return;
    tzdata.initializeTimeZones();
    // 与后端口径一致钉死上海时区（app.js 首行 TZ=Asia/Shanghai）；tz.local 默认是 UTC，
    // 不设的话 21:00 的提醒会在早上 5 点响。
    tz.setLocalLocation(tz.getLocation('Asia/Shanghai'));
    await _plugin.initialize(
      const InitializationSettings(
        iOS: DarwinInitializationSettings(
          // 权限统一走 requestPermission()，初始化时不弹
          requestAlertPermission: false,
          requestBadgePermission: false,
          requestSoundPermission: false,
        ),
      ),
    );
    _inited = true;
  }

  /// 申请通知权限。false = 用户在系统弹窗里拒绝（或之前拒绝过，iOS 不会再弹）。
  Future<bool> requestPermission() async {
    await _ensureInit();
    final ios = _plugin.resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>();
    final ok = await ios?.requestPermissions(alert: true, badge: true, sound: true);
    return ok ?? false;
  }

  // ===== 偏好 =====

  Future<bool> get enabled async => (await SharedPreferences.getInstance()).getBool(_kEnabled) ?? false;

  Future<(int, int)> get time async {
    final sp = await SharedPreferences.getInstance();
    return (sp.getInt(_kHour) ?? 21, sp.getInt(_kMinute) ?? 0);
  }

  Future<bool> get prompted async => (await SharedPreferences.getInstance()).getBool(_kPrompted) ?? false;

  Future<void> markPrompted() async =>
      (await SharedPreferences.getInstance()).setBool(_kPrompted, true);

  /// 开/关提醒（开=申请权限+排程；关=清掉全部排程）。返回是否成功开启。
  Future<bool> setEnabled(bool on) async {
    final sp = await SharedPreferences.getInstance();
    if (!on) {
      await sp.setBool(_kEnabled, false);
      await _ensureInit();
      await _plugin.cancel(_idDaily);
      await _plugin.cancel(_idRecall);
      return true;
    }
    final granted = await requestPermission();
    if (!granted) return false;
    await sp.setBool(_kEnabled, true);
    await applySchedule();
    return true;
  }

  Future<void> setTime(int hour, int minute) async {
    final sp = await SharedPreferences.getInstance();
    await sp.setInt(_kHour, hour);
    await sp.setInt(_kMinute, minute);
    if (await enabled) await applySchedule();
  }

  // ===== 排程 =====

  // 文案按星期轮换，避免"每天一模一样"被麻木掉。都指向同一个动作：打开 App 记账/看小结。
  static const _dailyLines = [
    '收摊了吗？口述一句今天的账，10 秒记完', // 周一
    '今天卖了多少？打开看看收摊小结',
    '别忘了今天的进货和开销，现在记最省事',
    '收摊对个账，欠款库存心里有数',
    '今天的账记了吗？口述一句就行',
    '周末生意好，账目别攒着，现在记一笔',
    '看看本周卖了多少——报表里都算好了',
  ];

  static const _details = NotificationDetails(
    iOS: DarwinNotificationDetails(presentAlert: true, presentSound: true, presentBadge: false),
  );

  tz.TZDateTime _nextDaily(int hour, int minute) {
    final now = tz.TZDateTime.now(tz.local);
    var at = tz.TZDateTime(tz.local, now.year, now.month, now.day, hour, minute);
    if (!at.isAfter(now)) at = at.add(const Duration(days: 1));
    return at;
  }

  /// 重排全部提醒。开着提醒的用户每次打开 App 调一次（dashboard），效果：
  /// - 每日提醒保持在设定时刻（matchDateTimeComponents 每天重复）
  /// - 召回顺延到 3 天后（打开了就重置，永远只在"3 天没来"时响）
  Future<void> applySchedule() async {
    if (!await enabled) return;
    await _ensureInit();
    final (h, m) = await time;
    final first = _nextDaily(h, m);
    await _plugin.cancel(_idDaily);
    await _plugin.cancel(_idRecall);
    await _plugin.zonedSchedule(
      _idDaily,
      '智存 · 收摊小结',
      _dailyLines[(first.weekday - 1) % 7],
      first,
      _details,
      androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
      uiLocalNotificationDateInterpretation: UILocalNotificationDateInterpretation.absoluteTime,
      matchDateTimeComponents: DateTimeComponents.time, // 每天同一时刻
    );
    final recallAt = tz.TZDateTime(tz.local, first.year, first.month, first.day, h, m)
        .add(const Duration(days: 3));
    await _plugin.zonedSchedule(
      _idRecall,
      '智存',
      '三天没记账了，库存和欠款容易对不上——回来看一眼？',
      recallAt,
      _details,
      androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
      uiLocalNotificationDateInterpretation: UILocalNotificationDateInterpretation.absoluteTime,
    );
  }

  /// 调试/测试用：当前挂着的排程
  Future<List<PendingNotificationRequest>> pending() async {
    await _ensureInit();
    return _plugin.pendingNotificationRequests();
  }
}
