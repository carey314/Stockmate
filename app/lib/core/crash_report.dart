import 'dart:io';

import 'package:flutter/foundation.dart';

import 'api.dart';

/// 客户端崩溃自动上报。
///
/// 为什么不用 Sentry/Firebase：那些 SDK 会顺带采集设备指纹和行为轨迹，
/// 和我们对用户承诺的"不做画像追踪"直接冲突，还得改 App Store 隐私标签。
/// 我们只把「报错文本 + 堆栈 + 平台 + 版本」发回自己的服务器，够定位问题就行。
///
/// 上报本身必须绝对安静：不弹提示、不阻塞、失败就算了。
/// 用户已经崩了一次，不能再被"上报失败"套娃打扰。
class CrashReport {
  CrashReport._();

  /// 与 pubspec.yaml 的 version 保持一致（改版本号时记得同步这里）
  static const appVersion = '0.1.0+1';

  static const _maxPerSession = 20; // 防止崩溃循环把服务器刷爆
  static int _sent = 0;
  static final Set<String> _seen = {}; // 同一条错误一个会话只报一次

  static Future<void> report(String level, Object error, StackTrace? stack) async {
    final message = error.toString();
    final key = '$level|${message.substring(0, message.length.clamp(0, 120))}';
    if (_sent >= _maxPerSession || !_seen.add(key)) return;
    _sent++;
    try {
      await Api.I.post('/client-logs', data: {
        'level': level,
        'message': message,
        if (stack != null) 'stack': stack.toString(),
        'platform': Platform.isIOS ? 'ios' : (Platform.isAndroid ? 'android' : 'other'),
        'appVersion': appVersion,
      });
    } catch (_) {
      /* 上报失败就算了，绝不能因此再抛错 */
    }
  }

  /// 挂上全局捕获：Flutter 框架错误、平台异步错误。
  /// runZonedGuarded 的兜底在 main() 里挂（要包住 runApp）。
  static void install() {
    final previous = FlutterError.onError;
    FlutterError.onError = (details) {
      previous?.call(details); // 保留默认行为：debug 下红屏 + 控制台堆栈照旧
      report('flutter', details.exception, details.stack);
    };
    PlatformDispatcher.instance.onError = (error, stack) {
      report('platform', error, stack);
      return true; // 已处理，不让它把 App 整个带崩
    };
  }
}
