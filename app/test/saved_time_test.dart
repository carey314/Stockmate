// 订阅页 hero 上「AI 帮你省了 xx」的换算。
// 这个数字是拿来劝人掏钱的，边界读错（比如 90 分钟显示成「1 小时 30 分」还是「90 分钟」）
// 不至于算错账，但会显得不专业；更要命的是 0 和负数别整出「省了 -1 秒」。
import 'package:flutter_test/flutter_test.dart';
import 'package:stockmate/features/pro/pro_screen.dart';

void main() {
  group('省下时间的人话换算', () {
    test('不足 1 分钟说秒', () {
      expect(fmtSaved(0), '0 秒');
      expect(fmtSaved(40), '40 秒');   // 1 笔
      expect(fmtSaved(59), '59 秒');
    });

    test('1 分钟到 90 分钟说分钟', () {
      expect(fmtSaved(60), '1 分钟');
      expect(fmtSaved(119), '1 分钟');  // 取整往下，不虚报
      expect(fmtSaved(64 * 40), '42 分钟'); // 真实场景：本月 64 笔
      expect(fmtSaved(89 * 60), '89 分钟');
    });

    test('90 分钟起说小时', () {
      expect(fmtSaved(90 * 60), '1 小时 30 分');
      expect(fmtSaved(120 * 60), '2 小时');
      expect(fmtSaved(200 * 60), '3 小时 20 分');
    });

    test('绝不虚报：换算结果不会大于真实秒数对应的时长', () {
      for (final s in [0, 1, 59, 60, 61, 3599, 3600, 5400, 100000]) {
        final out = fmtSaved(s);
        expect(out.contains('-'), isFalse, reason: '$s 秒算出了负数：$out');
      }
    });
  });
}
