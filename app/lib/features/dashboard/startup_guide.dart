import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';

/// 开工三步：新用户的冷启动引导。
///
/// 几个刻意的选择：
/// - **不预设任何品类**。给所有人塞"酒水/玩具/餐饮食材"，对水果店老板就是三个要删的垃圾，
///   还传递了"这软件不懂我"。让他自己说出行业，AI 现场配——这才是"30秒配成你这行"。
/// - **不弹窗**。弹窗会被随手关掉且再也不出现；常驻卡片才有第二次、第三次机会。
/// - **完成状态由真实数据推导**（有品类/有商品/开过单），不额外存标记。
///   这样从任何路径完成都算数，不会出现"我明明建了商品，它还说我没建"的尴尬。
/// - 三步做完卡片自动消失，首页恢复干净。
class StartupGuide extends ConsumerWidget {
  const StartupGuide({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final types = ref.watch(typesProvider).valueOrNull;
    final overview = ref.watch(overviewProvider).valueOrNull;
    final orders = ref.watch(ordersProvider).valueOrNull;
    // 数据还没到就先不显示，免得闪一下又消失
    if (types == null || overview == null || orders == null) return const SizedBox.shrink();

    final hasType = types.isNotEmpty;
    final hasProduct = overview.productCount > 0;
    final hasOrder = orders.isNotEmpty;
    if (hasType && hasProduct && hasOrder) return const SizedBox.shrink(); // 出师了，功成身退

    final t = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AiGradientCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            const Icon(Icons.rocket_launch_rounded, size: 18, color: AppColors.primary),
            const SizedBox(width: 6),
            Text('三步开工', style: t.labelMedium?.copyWith(color: AppColors.primary)),
          ]),
          const SizedBox(height: 10),
          Text('花 1 分钟配成你这行的样子', style: t.titleLarge),
          const SizedBox(height: 4),
          Text('每做完一步自动打勾，全做完这张卡就消失', style: t.bodyMedium?.copyWith(fontSize: 12)),
          const SizedBox(height: 14),
          _Step(
            index: 1,
            done: hasType,
            title: '告诉 AI 你做什么生意',
            hint: hasType ? '已配好「${types.first.name}」' : '它来配这行该记的字段，不用你想',
            onTap: () => _pickTrade(context),
          ),
          _Step(
            index: 2,
            done: hasProduct,
            title: '录几个常卖的货',
            hint: hasProduct ? '已有 ${overview.productCount} 个商品' : (hasType ? 'AI 能按你的行业列一批，勾选就入库' : '先做第 1 步'),
            onTap: hasType ? () => context.push('/types/${types.first.id}') : () => _pickTrade(context),
          ),
          _Step(
            index: 3,
            done: hasOrder,
            title: '记第一笔账',
            hint: hasOrder ? '已经开始记了' : '说一句话就行，不用打字',
            onTap: () => context.push('/voice-entry'),
            last: true,
          ),
        ]),
      ),
    );
  }

  /// 问他做什么生意。给气泡是因为很多人对着空输入框想不出该写什么，
  /// 但气泡只是提示——自己打字永远优先（"卖螺蛳粉的"也该能用）。
  void _pickTrade(BuildContext context) {
    const trades = ['水果店', '酒水批发', '便利店', '餐饮食材', '服装店', '五金建材', '母婴用品', '文具店', '茶叶店', '宠物用品'];
    final input = TextEditingController();
    void go(String theme) {
      final v = theme.trim();
      if (v.isEmpty) return;
      Navigator.pop(context);
      context.push('/types/new?theme=${Uri.encodeComponent(v)}');
    }

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(24, 24, 24, MediaQuery.of(ctx).viewInsets.bottom + 28),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('你是做什么生意的？', style: Theme.of(ctx).textTheme.headlineMedium),
          const SizedBox(height: 6),
          Text('说得越具体越好，AI 按这个给你配商品要记哪些信息',
              style: Theme.of(ctx).textTheme.bodyMedium?.copyWith(fontSize: 13)),
          const SizedBox(height: 16),
          TextField(
            controller: input,
            autofocus: true,
            textInputAction: TextInputAction.go,
            decoration: const InputDecoration(hintText: '比如：卖卤味的、开馄饨摊的、批发酒水'),
            onSubmitted: go,
          ),
          const SizedBox(height: 14),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final tr in trades)
                ActionChip(
                  label: Text(tr),
                  onPressed: () => go(tr),
                ),
            ],
          ),
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            child: FilledButton(onPressed: () => go(input.text), child: const Text('让 AI 配')),
          ),
        ]),
      ),
    );
  }
}

class _Step extends StatelessWidget {
  final int index;
  final bool done;
  final String title;
  final String hint;
  final VoidCallback onTap;
  final bool last;
  const _Step({
    required this.index,
    required this.done,
    required this.title,
    required this.hint,
    required this.onTap,
    this.last = false,
  });

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return InkWell(
      onTap: done ? null : onTap,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: EdgeInsets.only(top: 8, bottom: last ? 4 : 8),
        child: Row(children: [
          Container(
            width: 26,
            height: 26,
            decoration: BoxDecoration(
              color: done ? AppColors.success : AppColors.primary,
              shape: BoxShape.circle,
            ),
            alignment: Alignment.center,
            child: done
                ? const Icon(Icons.check_rounded, size: 16, color: Colors.white)
                : Text('$index', style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w700)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(
                title,
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                  color: done ? AppColors.onSurfaceVariant : AppColors.onSurface,
                  decoration: done ? TextDecoration.lineThrough : null,
                ),
              ),
              const SizedBox(height: 2),
              Text(hint, style: t.bodyMedium?.copyWith(fontSize: 12)),
            ]),
          ),
          if (!done) const Icon(Icons.chevron_right_rounded, color: AppColors.primary),
        ]),
      ),
    );
  }
}
