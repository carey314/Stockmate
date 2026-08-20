import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../core/api.dart';
import '../../core/local_notice.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import 'startup_guide.dart';
import '../notifications/notifications_screen.dart';

final _money = NumberFormat('#,##0.##');

// 每次冷启动进首页时重排提醒（召回顺延到 3 天后；没开提醒的用户零成本直接返回）
bool _noticeRefreshed = false;

/// 首页看板：今日毛利大数字 + AI 口述入口 + 关键指标
class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  /// 日结快录：日期 + 金额 + 备注，3 秒记一笔总营业额（不涉及库存）
  Future<void> _quickDailyIncome(BuildContext context, WidgetRef ref) async {
    final amount = TextEditingController();
    final note = TextEditingController();
    DateTime date = DateTime.now();
    final df = DateFormat('yyyy-MM-dd');

    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModal) => Padding(
          padding: EdgeInsets.fromLTRB(24, 24, 24, MediaQuery.of(ctx).viewInsets.bottom + 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('日结快录', style: Theme.of(ctx).textTheme.headlineMedium),
              const SizedBox(height: 4),
              Text('忙一天没记单笔？一笔录总营业额，计入收入', style: Theme.of(ctx).textTheme.bodyMedium),
              const SizedBox(height: 16),
              GestureDetector(
                onTap: () async {
                  final picked = await showDatePicker(
                    context: ctx,
                    initialDate: date,
                    firstDate: DateTime(2020),
                    lastDate: DateTime.now(),
                  );
                  if (picked != null) setModal(() => date = picked);
                },
                child: InputDecorator(
                  decoration: const InputDecoration(),
                  child: Row(children: [
                    const Icon(Icons.calendar_today_outlined, size: 18, color: AppColors.onSurfaceVariant),
                    const SizedBox(width: 8),
                    Text(df.format(date)),
                  ]),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: amount,
                autofocus: true,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: '营业额 ¥'),
              ),
              const SizedBox(height: 12),
              TextField(controller: note, decoration: const InputDecoration(labelText: '备注（选填，如：夜市出摊）')),
              const SizedBox(height: 16),
              FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('记一笔')),
            ],
          ),
        ),
      ),
    );

    if (saved != true) return;
    final v = double.tryParse(amount.text);
    if (v == null || v <= 0) return;
    try {
      await Api.I.post('/incomes', data: {
        'source': '日结营业额',
        'amount': v,
        'incomeDate': df.format(date),
        if (note.text.trim().isNotEmpty) 'note': note.text.trim(),
      });
      ref.invalidate(overviewProvider);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('✓ 已记 ${df.format(date)} 营业额 ¥$v')));
      }
    } catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!_noticeRefreshed) {
      _noticeRefreshed = true;
      LocalNotice.I.applySchedule(); // fire-and-forget，没开提醒时内部直接 return
    }
    final t = Theme.of(context).textTheme;
    final overview = ref.watch(overviewProvider);

    return Scaffold(
      appBar: AppBar(
        leading: Builder(
          builder: (ctx) => IconButton(icon: const Icon(Icons.menu_rounded), onPressed: () => Scaffold.of(ctx).openDrawer()),
        ),
        title: const Text('StockMate 智存'),
        actions: [
          // 铃铛：有未读通知亮红点（通知=待办：库存预警/欠款/今日小结）
          Consumer(builder: (context, ref, _) {
            final hasUnread = ref.watch(hasUnreadProvider).valueOrNull ?? false;
            return IconButton(
              icon: Stack(clipBehavior: Clip.none, children: [
                const Icon(Icons.notifications_none_rounded),
                if (hasUnread)
                  Positioned(
                    right: -1,
                    top: -1,
                    child: Container(width: 9, height: 9, decoration: const BoxDecoration(color: AppColors.error, shape: BoxShape.circle)),
                  ),
              ]),
              onPressed: () async {
                await context.push('/notifications');
                ref.invalidate(hasUnreadProvider);
              },
            );
          }),
        ],
      ),
      // 左上角汉堡 → 侧边栏（品类管理主入口）
      drawer: _SideDrawer(),
      body: RefreshIndicator(
        onRefresh: () async => ref.refresh(overviewProvider.future),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(kPagePadding, 8, kPagePadding, 120),
          children: [
            Text('今天生意怎么样？', style: t.headlineLarge),
            const SizedBox(height: 20),
            overview.when(
              loading: () => const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator())),
              error: (e, _) => SoftCard(child: Text('加载失败：$e', style: t.bodyMedium)),
              data: (o) => Column(
                children: [
                  // 冷启动引导：没配过品类/没商品/没开过单时出现，三步做完自动消失
                  const StartupGuide(),
                  // 今日毛利大数字卡（小摊主唯一关心的数字）
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [Color(0xFFE1E0FF), Color(0xFFF3EDFF)],
                      ),
                      borderRadius: BorderRadius.circular(kRadiusCard),
                      boxShadow: kCardShadow,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(children: [
                          const Icon(Icons.account_balance_wallet_outlined, size: 18, color: AppColors.primary),
                          const SizedBox(width: 6),
                          Text('今日毛利', style: t.labelMedium?.copyWith(color: AppColors.primary)),
                        ]),
                        const SizedBox(height: 10),
                        Text(
                          '¥ ${_money.format(o.todayProfit)}',
                          style: TextStyle(
                            fontSize: 40,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -0.5,
                            color: o.todayProfit >= 0 ? AppColors.onSurface : AppColors.error,
                          ),
                        ),
                        const SizedBox(height: 12),
                        Text(
                          '销售 ¥${_money.format(o.todaySales)} − 成本 ¥${_money.format(o.todayCogs)} − 开销 ¥${_money.format(o.todayExpenses)}',
                          style: t.bodyMedium,
                        ),
                        // 有货没填进价时，毛利是虚高的——必须说出来，不能让老板拿假数字做决策
                        if (o.profitUnreliable) ...[
                          const SizedBox(height: 10),
                          GestureDetector(
                            onTap: () => context.push('/products'),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.7),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Row(children: [
                                const Icon(Icons.info_outline_rounded, size: 15, color: AppColors.warning),
                                const SizedBox(width: 6),
                                Expanded(
                                  child: Text(
                                    '其中 ¥${_money.format(o.noCostSales)} 的货没填进价，实际毛利没这么高'
                                    '${o.noCostProductNames.isEmpty ? '' : '（${o.noCostProductNames.join("、")}…）'}',
                                    style: const TextStyle(fontSize: 11, height: 1.4, color: AppColors.warning),
                                  ),
                                ),
                              ]),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: 8),
                  // 昨天一行：开门第一眼想知道的就是"昨天到底赚没赚"
                  const _YesterdayLine(),
                  const SizedBox(height: 8),
                  // AI 口述录入入口（✨ 渐变卡，产品灵魂交互）
                  AiGradientCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(children: [
                          const Icon(Icons.auto_awesome, size: 18, color: AppColors.primary),
                          const SizedBox(width: 6),
                          Text('AI 口述记账', style: t.labelMedium?.copyWith(color: AppColors.primary)),
                        ]),
                        const SizedBox(height: 10),
                        Text('说一句话，进货卖货开销全记好', style: t.titleLarge),
                        const SizedBox(height: 6),
                        Text('比如："卖了3袋虾仁馄饨75块，摊位费50"', style: t.bodyMedium),
                        const SizedBox(height: 16),
                        FilledButton.icon(
                          onPressed: () => context.push('/voice-entry'),
                          icon: const Icon(Icons.mic_rounded, size: 20),
                          label: const Text('开始记账'),
                        ),
                        const SizedBox(height: 4),
                        // 收摊快录：没记单笔也能一笔录总数
                        Center(
                          child: TextButton(
                            onPressed: () => _quickDailyIncome(context, ref),
                            child: const Text('收摊了？只记一笔总营业额 →', style: TextStyle(fontSize: 13)),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  // 该补货了：缺货时直接列出来，一键开进货单（不用先翻商品页找）
                  if (o.lowStockCount > 0) ...[
                    const _LowStockCard(),
                    const SizedBox(height: 16),
                  ],
                  // 指标行（可点：直达对应页面）
                  Row(children: [
                    Expanded(
                      child: _StatCard(
                        label: '今日订单',
                        value: '${o.todayOrderCount}',
                        icon: Icons.receipt_long_outlined,
                        onTap: () => context.push('/orders'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _StatCard(
                        label: '库存预警',
                        value: '${o.lowStockCount}',
                        icon: Icons.warning_amber_rounded,
                        valueColor: o.lowStockCount > 0 ? AppColors.warning : null,
                        onTap: () => context.push('/products'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _StatCard(
                        label: '商品数',
                        value: '${o.productCount}',
                        icon: Icons.inventory_2_outlined,
                        onTap: () => context.push('/products'),
                      ),
                    ),
                  ]),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 该补货了：把缺货的规格直接摆出来，一键开进货单
/// 昨天的销售/毛利（调 /reports/profit 单日）
final _yesterdayProvider = FutureProvider<Map<String, dynamic>?>((ref) async {
  final d = DateTime.now().subtract(const Duration(days: 1));
  final s = '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  try {
    final r = await Api.I.get('/reports/profit', query: {'startDate': s, 'endDate': s});
    return Map<String, dynamic>.from(r);
  } catch (_) {
    return null; // 员工没权限看利润 → 静默不显示
  }
});

class _YesterdayLine extends ConsumerWidget {
  const _YesterdayLine();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final y = ref.watch(_yesterdayProvider).valueOrNull;
    if (y == null || (y['orderCount'] ?? 0) == 0) return const SizedBox.shrink();
    final t = Theme.of(context).textTheme;
    return GestureDetector(
      onTap: () => context.push('/reports'),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: Text(
          '昨天：卖了 ¥${_money.format(y['sales'] ?? 0)}，赚了 ¥${_money.format(y['profit'] ?? 0)} →',
          style: t.bodyMedium?.copyWith(fontSize: 12, color: AppColors.onSurfaceVariant),
        ),
      ),
    );
  }
}

class _LowStockCard extends ConsumerWidget {
  const _LowStockCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = Theme.of(context).textTheme;
    final alerts = ref.watch(lowStockProvider);
    return alerts.maybeWhen(
      data: (list) {
        if (list.isEmpty) return const SizedBox.shrink();
        return SoftCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              const Icon(Icons.shopping_basket_outlined, size: 18, color: AppColors.warning),
              const SizedBox(width: 6),
              Text('该补货了（${list.length}）', style: t.titleMedium),
            ]),
            const SizedBox(height: 10),
            for (final a in list.take(4))
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(children: [
                  Expanded(
                    child: Text(
                      '${a['sku']?['product']?['name'] ?? '-'}'
                      '${(a['sku']?['specText'] ?? '') != '' ? ' · ${a['sku']['specText']}' : ''}',
                      style: t.bodyMedium?.copyWith(fontSize: 13),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Text('剩 ${a['quantity']}',
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.warning)),
                  Text(' / 预警 ${a['minQuantity']}', style: const TextStyle(fontSize: 12, color: AppColors.onSurfaceVariant)),
                ]),
              ),
            if (list.length > 4)
              Text('还有 ${list.length - 4} 个规格缺货', style: t.bodyMedium?.copyWith(fontSize: 12)),
            const SizedBox(height: 6),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: () async {
                  await context.push('/purchase-orders/new');
                  ref.invalidate(lowStockProvider);
                  ref.invalidate(overviewProvider);
                },
                icon: const Icon(Icons.add_shopping_cart_rounded, size: 18),
                label: const Text('开进货单补货'),
              ),
            ),
          ]),
        );
      },
      orElse: () => const SizedBox.shrink(),
    );
  }
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final Color? valueColor;
  final VoidCallback? onTap;
  const _StatCard({required this.label, required this.value, required this.icon, this.valueColor, this.onTap});

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return SoftCard(
      onTap: onTap,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: AppColors.onSurfaceVariant),
          const SizedBox(height: 10),
          Text(value, style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: valueColor ?? AppColors.onSurface)),
          const SizedBox(height: 2),
          Text(label, style: t.bodyMedium?.copyWith(fontSize: 12)),
        ],
      ),
    );
  }
}

/// 侧边栏：品类/模板管理主入口 + 设置
class _SideDrawer extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = Theme.of(context).textTheme;
    final types = ref.watch(typesProvider);

    return Drawer(
      backgroundColor: AppColors.surface,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('我的品类', style: t.headlineMedium),
              const SizedBox(height: 4),
              Text('每种生意一套字段，AI 帮你配', style: t.bodyMedium),
              const SizedBox(height: 20),
              Expanded(
                child: types.when(
                  loading: () => const Center(child: CircularProgressIndicator()),
                  error: (e, _) => Text('加载失败：$e'),
                  data: (list) => ListView(
                    children: [
                      for (final type in list)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: SoftCard(
                            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                            onTap: () {
                              Navigator.pop(context);
                              context.push('/types/${type.id}');
                            },
                            child: Row(
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(type.name, style: t.titleMedium),
                                      const SizedBox(height: 2),
                                      Text('${type.fields.length} 个字段 · ${type.productCount} 件商品',
                                          style: t.bodyMedium?.copyWith(fontSize: 12)),
                                    ],
                                  ),
                                ),
                                const Icon(Icons.chevron_right_rounded, color: AppColors.onSurfaceVariant),
                              ],
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
              FilledButton.icon(
                onPressed: () {
                  Navigator.pop(context);
                  context.push('/types');
                },
                icon: const Icon(Icons.dashboard_customize_outlined, size: 20),
                label: const Text('管理品类 / 新建'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
