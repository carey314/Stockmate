import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'theme.dart';

/// 庆祝层：注册开张 / 订阅解锁 这两个"情绪最高的时刻"共用。
///
/// 之前这两个时刻都只有一条 toast——用户刚把钱付了/刚开完店，界面毫无表示，
/// 像自动售货机掉出一罐可乐。这里给礼花 + 弹性图标 + 渐入文案，两秒钟的仪式感。
///
/// 刻意用纯 Flutter 动画原语实现（CustomPainter 礼花 + AnimationController），
/// 不引 lottie/confetti 第三方包：上架前不加依赖，包体也不多一个字节的资源。
///
/// 两种收场：
///   buttonLabel == null → 自动消失（注册流：别挡着首页的三步开工）
///   buttonLabel != null → 等用户点按钮（付费流：花了钱的时刻值得一次确认的点击）
Future<void> showCelebration(
  BuildContext context, {
  required IconData icon,
  required String title,
  required String subtitle,
  String? buttonLabel,
  Duration autoDismiss = const Duration(milliseconds: 2400),
}) {
  HapticFeedback.heavyImpact(); // 开香槟的"砰"
  return showGeneralDialog<void>(
    context: context,
    useRootNavigator: true, // 挂根导航：底下的路由怎么切换（登录→首页）都盖得住
    barrierDismissible: false,
    barrierLabel: 'celebration',
    barrierColor: const Color(0xB3000000), // 70% 黑：底下页面退远一点，礼花和文案更聚焦
    transitionDuration: const Duration(milliseconds: 220),
    transitionBuilder: (_, anim, __, child) => FadeTransition(opacity: anim, child: child),
    // Material(transparency) 必须包：对话框路由外没有 Material 祖先，
    // Text 会落到"黄色双下划线"的报错样式上（真机截图抓到过）
    pageBuilder: (ctx, _, __) => Material(
      type: MaterialType.transparency,
      child: _CelebrationView(
        icon: icon,
        title: title,
        subtitle: subtitle,
        buttonLabel: buttonLabel,
        autoDismiss: autoDismiss,
      ),
    ),
  );
}

class _CelebrationView extends StatefulWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final String? buttonLabel;
  final Duration autoDismiss;
  const _CelebrationView({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.buttonLabel,
    required this.autoDismiss,
  });

  @override
  State<_CelebrationView> createState() => _CelebrationViewState();
}

class _CelebrationViewState extends State<_CelebrationView> with SingleTickerProviderStateMixin {
  late final AnimationController _c;
  bool _popped = false;

  @override
  void initState() {
    super.initState();
    _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 2600))..forward();
    if (widget.buttonLabel == null) {
      Future.delayed(widget.autoDismiss, _dismiss);
    }
  }

  void _dismiss() {
    if (_popped || !mounted) return;
    _popped = true;
    Navigator.of(context, rootNavigator: true).pop();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // 弹性入场的图标（前 0.35 段），文案随后渐入上浮
    final iconScale = CurvedAnimation(parent: _c, curve: const Interval(0, 0.35, curve: Curves.elasticOut));
    final textIn = CurvedAnimation(parent: _c, curve: const Interval(0.12, 0.4, curve: Curves.easeOutCubic));
    final btnIn = CurvedAnimation(parent: _c, curve: const Interval(0.35, 0.6, curve: Curves.easeOut));

    return GestureDetector(
      // 点哪都能跳过/收场——仪式感不该变成强制广告
      onTap: widget.buttonLabel == null ? _dismiss : null,
      behavior: HitTestBehavior.opaque,
      child: Stack(children: [
        // 礼花层
        Positioned.fill(
          child: IgnorePointer(
            child: AnimatedBuilder(
              animation: _c,
              builder: (_, __) => CustomPaint(painter: _ConfettiPainter(_c.value)),
            ),
          ),
        ),
        // 内容层
        Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            ScaleTransition(
              scale: iconScale,
              child: Container(
                width: 96,
                height: 96,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [Color(0xFFFFD54F), Color(0xFFFFB300)], // 金——解锁/开张的颜色
                  ),
                  boxShadow: [
                    BoxShadow(color: const Color(0xFFFFB300).withValues(alpha: 0.45), blurRadius: 32, spreadRadius: 4),
                  ],
                ),
                child: Icon(widget.icon, size: 48, color: Colors.white),
              ),
            ),
            const SizedBox(height: 22),
            FadeTransition(
              opacity: textIn,
              child: SlideTransition(
                position: Tween(begin: const Offset(0, 0.25), end: Offset.zero).animate(textIn),
                child: Column(children: [
                  Text(widget.title,
                      style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: Colors.white)),
                  const SizedBox(height: 10),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 40),
                    child: Text(widget.subtitle,
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 15, height: 1.5, color: Colors.white70)),
                  ),
                ]),
              ),
            ),
            if (widget.buttonLabel != null) ...[
              const SizedBox(height: 30),
              FadeTransition(
                opacity: btnIn,
                child: FilledButton(
                  onPressed: _dismiss,
                  style: FilledButton.styleFrom(
                    backgroundColor: Colors.white,
                    foregroundColor: AppColors.primary,
                    minimumSize: const Size(160, 48),
                  ),
                  child: Text(widget.buttonLabel!,
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                ),
              ),
            ],
          ]),
        ),
      ]),
    );
  }
}

/// 礼花粒子：从上方中部炸开，重力下落 + 水平漂移 + 自转，尾段淡出。
/// 固定种子的伪随机——每次庆祝的礼花长得一样没关系，用户不会看两次对比。
class _ConfettiPainter extends CustomPainter {
  final double t; // 0..1
  _ConfettiPainter(this.t);

  static final List<_Particle> _particles = _make();

  static List<_Particle> _make() {
    final rnd = Random(7);
    const palette = [
      Color(0xFFFFC24B), // 金
      Color(0xFF4648D4), // 品牌靛蓝
      Color(0xFF6063EE),
      Color(0xFF34A853), // 绿
      Color(0xFFEF6C6C), // 红
      Colors.white,
    ];
    return List.generate(42, (i) {
      final angle = -pi / 2 + (rnd.nextDouble() - 0.5) * pi * 1.1; // 大致朝上的扇形
      final speed = 0.55 + rnd.nextDouble() * 0.85;
      return _Particle(
        color: palette[i % palette.length],
        x0: 0.5 + (rnd.nextDouble() - 0.5) * 0.22,
        y0: 0.34,
        vx: cos(angle) * speed,
        vy: sin(angle) * speed,
        size: 5 + rnd.nextDouble() * 5,
        spin: (rnd.nextDouble() - 0.5) * 10,
        circle: rnd.nextBool(),
        delay: rnd.nextDouble() * 0.12, // 不同步炸开，更像真礼花
      );
    });
  }

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint();
    for (final p in _particles) {
      final lt = ((t - p.delay) / (1 - p.delay)).clamp(0.0, 1.0);
      if (lt <= 0) continue;
      final fade = lt > 0.75 ? (1 - lt) / 0.25 : 1.0; // 尾段淡出
      paint.color = p.color.withValues(alpha: 0.9 * fade);
      final x = (p.x0 + p.vx * lt * 0.5) * size.width;
      final y = (p.y0 + p.vy * lt * 0.42 + 0.75 * lt * lt * 0.55) * size.height; // 初速上抛+重力
      canvas.save();
      canvas.translate(x, y);
      canvas.rotate(p.spin * lt);
      if (p.circle) {
        canvas.drawCircle(Offset.zero, p.size / 2, paint);
      } else {
        canvas.drawRRect(
          RRect.fromRectAndRadius(Rect.fromCenter(center: Offset.zero, width: p.size, height: p.size * 0.62), const Radius.circular(1.5)),
          paint,
        );
      }
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(covariant _ConfettiPainter old) => old.t != t;
}

class _Particle {
  final Color color;
  final double x0, y0, vx, vy, size, spin, delay;
  final bool circle;
  const _Particle({
    required this.color,
    required this.x0,
    required this.y0,
    required this.vx,
    required this.vy,
    required this.size,
    required this.spin,
    required this.circle,
    required this.delay,
  });
}
