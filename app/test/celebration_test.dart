// 庆祝层（注册开张/订阅解锁共用）的两种收场行为：
// 自动收场（注册流，别挡住三步开工）和按钮收场（付费流，值得一次确认的点击）。
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stockmate/core/celebration.dart';

Widget _host(void Function(BuildContext) onTap) => MaterialApp(
      home: Scaffold(body: Builder(builder: (ctx) => TextButton(onPressed: () => onTap(ctx), child: const Text('go')))),
    );

void main() {
  testWidgets('自动收场：到时自己消失，点一下也能提前跳过', (t) async {
    await t.pumpWidget(_host((ctx) => showCelebration(ctx,
        icon: Icons.storefront_rounded,
        title: '开张大吉',
        subtitle: '「测试店」建好了',
        autoDismiss: const Duration(milliseconds: 400))));
    await t.tap(find.text('go'));
    await t.pump(const Duration(milliseconds: 300)); // 入场过渡
    expect(find.text('开张大吉'), findsOneWidget);
    expect(find.byType(FilledButton), findsNothing, reason: '自动收场模式不该有按钮');
    // 等 autoDismiss 到点 + 退场过渡
    await t.pump(const Duration(milliseconds: 500));
    await t.pump(const Duration(milliseconds: 400));
    expect(find.text('开张大吉'), findsNothing, reason: '★ 到点必须自己消失，不能挡住首页');
  });

  testWidgets('按钮收场：不自动消失，点「开始用」才走', (t) async {
    await t.pumpWidget(_host((ctx) => showCelebration(ctx,
        icon: Icons.workspace_premium_rounded,
        title: '专业版已解锁',
        subtitle: 'AI 不限次',
        buttonLabel: '开始用')));
    await t.tap(find.text('go'));
    await t.pump(const Duration(milliseconds: 300));
    expect(find.text('专业版已解锁'), findsOneWidget);
    // 远超默认 autoDismiss 的时间后仍然在——付费的确认时刻不许自动溜走
    await t.pump(const Duration(seconds: 3));
    expect(find.text('专业版已解锁'), findsOneWidget, reason: '★ 按钮模式不许自动消失');
    await t.tap(find.text('开始用'));
    // 退场过渡要两帧：一帧走完动画、一帧摘除路由
    await t.pump(const Duration(milliseconds: 300));
    await t.pump(const Duration(milliseconds: 300));
    expect(find.text('专业版已解锁'), findsNothing);
  });
}
