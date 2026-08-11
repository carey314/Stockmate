import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../core/api.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';

final _money = NumberFormat('#,##0.##');
final _df = DateFormat('yyyy-MM-dd');

/// 日期区间状态（报表中心共用）
class DateRange {
  final DateTime start;
  final DateTime end;
  final String label;
  const DateRange(this.start, this.end, this.label);

  static DateRange today() {
    final n = DateTime.now();
    final d = DateTime(n.year, n.month, n.day);
    return DateRange(d, d, '今天');
  }

  static DateRange thisWeek() {
    final n = DateTime.now();
    final d = DateTime(n.year, n.month, n.day);
    return DateRange(d.subtract(Duration(days: d.weekday - 1)), d, '本周');
  }

  static DateRange thisMonth() {
    final n = DateTime.now();
    return DateRange(DateTime(n.year, n.month, 1), DateTime(n.year, n.month, n.day), '本月');
  }

  /// 「昨天卖得咋样」是每天早上开门第一问
  static DateRange yesterday() {
    final n = DateTime.now();
    final d = DateTime(n.year, n.month, n.day).subtract(const Duration(days: 1));
    return DateRange(d, d, '昨天');
  }

  /// 月初想跟上个月比一比
  static DateRange lastMonth() {
    final n = DateTime.now();
    final firstThis = DateTime(n.year, n.month, 1);
    final lastPrev = firstThis.subtract(const Duration(days: 1));
    return DateRange(DateTime(lastPrev.year, lastPrev.month, 1), lastPrev, '上月');
  }

  String get qs => 'startDate=${_df.format(start)}&endDate=${_df.format(end)}';
}

final reportRangeProvider = StateProvider<DateRange>((ref) => DateRange.thisMonth());

final profitReportProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  final r = ref.watch(reportRangeProvider);
  return Map<String, dynamic>.from(await Api.I.get('/reports/profit?${r.qs}'));
});
final salesReportProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  final r = ref.watch(reportRangeProvider);
  return Map<String, dynamic>.from(await Api.I.get('/reports/sales-by-product?${r.qs}'));
});
final inventoryReportProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  return Map<String, dynamic>.from(await Api.I.get('/reports/inventory'));
});
final cashflowReportProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  final r = ref.watch(reportRangeProvider);
  return Map<String, dynamic>.from(await Api.I.get('/reports/cashflow?${r.qs}'));
});
final staffPerfProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  final r = ref.watch(reportRangeProvider);
  return Map<String, dynamic>.from(await Api.I.get('/reports/staff-performance?${r.qs}'));
});
final purchaseStatsProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  final r = ref.watch(reportRangeProvider);
  return Map<String, dynamic>.from(await Api.I.get('/reports/purchase-stats?${r.qs}'));
});

/// 报表中心：经营利润 / 销售统计 / 库存统计 / 资金流水 / 客户对账单入口
class ReportsScreen extends ConsumerWidget {
  const ReportsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = Theme.of(context).textTheme;
    final range = ref.watch(reportRangeProvider);
    // 员工看不到利润/资金流水/员工业绩/AI问生意（后端同样有 403 拦截）
    final isAdmin = ref.watch(profileProvider).valueOrNull?['role'] == 'admin';

    return Scaffold(
      appBar: AppBar(title: const Text('报表中心')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(profitReportProvider);
          ref.invalidate(salesReportProvider);
          ref.invalidate(inventoryReportProvider);
          ref.invalidate(cashflowReportProvider);
          ref.invalidate(staffPerfProvider);
          ref.invalidate(purchaseStatsProvider);
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(kPagePadding, 8, kPagePadding, 40),
          children: [
            // 日期预设（chips 总宽超一屏，且"自定义"选中后 label 变长——必须横向可滑）
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(children: [
              for (final r in [DateRange.today(), DateRange.yesterday(), DateRange.thisWeek(), DateRange.thisMonth(), DateRange.lastMonth()]) ...[
                ChoiceChip(
                  label: Text(r.label),
                  selected: range.label == r.label,
                  onSelected: (_) => ref.read(reportRangeProvider.notifier).state = r,
                ),
                const SizedBox(width: 8),
              ],
              ChoiceChip(
                label: Text(range.label == '自定义' ? '${_df.format(range.start)}~${_df.format(range.end)}' : '自定义'),
                selected: range.label == '自定义',
                onSelected: (_) async {
                  final picked = await showDateRangePicker(
                    context: context,
                    firstDate: DateTime(2024),
                    lastDate: DateTime.now(),
                    initialDateRange: DateTimeRange(start: range.start, end: range.end),
                  );
                  if (picked != null) {
                    ref.read(reportRangeProvider.notifier).state = DateRange(picked.start, picked.end, '自定义');
                  }
                },
              ),
              ]),
            ),
            const SizedBox(height: 16),
            // ===== AI 问生意入口（仅老板） =====
            if (isAdmin) ...[
            AiGradientCard(
              child: GestureDetector(
                onTap: () => context.push('/ask'),
                behavior: HitTestBehavior.opaque,
                child: Row(children: [
                  const Icon(Icons.auto_awesome, color: AppColors.primary),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('AI 问生意', style: t.titleMedium),
                      Text('"谁欠我钱？""这个月赚了吗？"——直接问', style: t.bodyMedium?.copyWith(fontSize: 12)),
                    ]),
                  ),
                  const Icon(Icons.chevron_right_rounded, color: AppColors.onSurfaceVariant),
                ]),
              ),
            ),
            const SizedBox(height: 14),
            // ===== 经营利润 =====
            _ProfitCard(),
            const SizedBox(height: 14),
            ],
            // ===== 销售统计（按商品） =====
            _SalesCard(),
            const SizedBox(height: 14),
            // ===== 热销分析（按销量） =====
            _HotCard(),
            const SizedBox(height: 14),
            // ===== 库存统计 =====
            _InventoryCard(),
            const SizedBox(height: 14),
            // ===== 进货统计 =====
            _PurchaseStatsCard(),
            const SizedBox(height: 14),
            // ===== 员工业绩 + 资金流水（仅老板） =====
            if (isAdmin) ...[
            _StaffCard(),
            const SizedBox(height: 14),
            _CashflowCard(),
            const SizedBox(height: 14),
            ],
            // ===== 客户对账单入口 =====
            SoftCard(
              onTap: () => _pickCustomerForStatement(context, ref),
              child: Row(children: [
                const Icon(Icons.receipt_long_rounded, color: AppColors.primary),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('客户对账单', style: t.titleMedium),
                    Text('期初欠款 + 期间往来 + 期末欠款，可分享给客户', style: t.bodyMedium?.copyWith(fontSize: 12)),
                  ]),
                ),
                const Icon(Icons.chevron_right_rounded, color: AppColors.onSurfaceVariant),
              ]),
            ),
            const SizedBox(height: 14),
            // ===== 供应商对账单入口 =====
            SoftCard(
              onTap: () => _pickSupplierForStatement(context, ref),
              child: Row(children: [
                const Icon(Icons.local_shipping_outlined, color: AppColors.primary),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('供应商对账单', style: t.titleMedium),
                    Text('我欠供应商多少、付了多少，一目了然', style: t.bodyMedium?.copyWith(fontSize: 12)),
                  ]),
                ),
                const Icon(Icons.chevron_right_rounded, color: AppColors.onSurfaceVariant),
              ]),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _pickSupplierForStatement(BuildContext context, WidgetRef ref) async {
    final suppliers = await ref.read(suppliersProvider.future);
    if (!context.mounted) return;
    if (suppliers.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('还没有供应商')));
      return;
    }
    final picked = await showModalBottomSheet<Supplier>(
      context: context,
      builder: (ctx) => SafeArea(
        child: ListView(padding: const EdgeInsets.all(20), shrinkWrap: true, children: [
          Text('选择供应商', style: Theme.of(ctx).textTheme.headlineMedium),
          const SizedBox(height: 12),
          for (final s in suppliers) ListTile(title: Text(s.name), onTap: () => Navigator.pop(ctx, s)),
        ]),
      ),
    );
    if (picked != null && context.mounted) context.push('/reports/supplier-statement/${picked.id}');
  }

  Future<void> _pickCustomerForStatement(BuildContext context, WidgetRef ref) async {
    final customers = await ref.read(customersProvider.future);
    if (!context.mounted) return;
    if (customers.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('还没有客户')));
      return;
    }
    final picked = await showModalBottomSheet<Customer>(
      context: context,
      builder: (ctx) => SafeArea(
        child: ListView(padding: const EdgeInsets.all(20), shrinkWrap: true, children: [
          Text('选择客户', style: Theme.of(ctx).textTheme.headlineMedium),
          const SizedBox(height: 12),
          for (final c in customers) ListTile(title: Text(c.name), onTap: () => Navigator.pop(ctx, c)),
        ]),
      ),
    );
    if (picked != null && context.mounted) context.push('/reports/statement/${picked.id}');
  }
}

class _SectionTitle extends StatelessWidget {
  final String title;
  const _SectionTitle(this.title);
  @override
  Widget build(BuildContext context) =>
      Padding(padding: const EdgeInsets.only(bottom: 10), child: Text(title, style: Theme.of(context).textTheme.titleMedium));
}

Widget _loadErrEmpty(AsyncValue v, Widget Function(dynamic) builder) {
  return v.when(
    loading: () => const Padding(padding: EdgeInsets.all(20), child: Center(child: CircularProgressIndicator())),
    error: (e, _) => Padding(padding: const EdgeInsets.all(8), child: Text('加载失败：$e', style: const TextStyle(fontSize: 12))),
    data: builder,
  );
}

class _ProfitCard extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = Theme.of(context).textTheme;
    return SoftCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const _SectionTitle('经营利润'),
        _loadErrEmpty(ref.watch(profitReportProvider), (d) {
          final profit = (d['profit'] ?? 0).toDouble();
          return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('¥${_money.format(profit)}',
                style: TextStyle(fontSize: 32, fontWeight: FontWeight.w700, color: profit >= 0 ? AppColors.onSurface : AppColors.error)),
            const SizedBox(height: 6),
            Text('销售 ¥${_money.format(d['sales'])} − 成本 ¥${_money.format(d['cogs'])} − 开销 ¥${_money.format(d['expenses'])} · ${d['orderCount']}单',
                style: t.bodyMedium?.copyWith(fontSize: 12)),
            // 损耗单列（报损/过期/损坏，按当前进价估算）——让老板看见"烂掉多少钱"
            if (((d['lossAmount'] ?? 0) as num) > 0) ...[
              const SizedBox(height: 4),
              Text('另有损耗 ¥${_money.format(d['lossAmount'])}（报损/过期/损坏，按进价估）',
                  style: t.bodyMedium?.copyWith(fontSize: 12, color: AppColors.warning)),
            ],
          ]);
        }),
      ]),
    );
  }
}

class _SalesCard extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = Theme.of(context).textTheme;
    return SoftCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const _SectionTitle('销售统计 · 按商品'),
        _loadErrEmpty(ref.watch(salesReportProvider), (d) {
          final list = List<Map<String, dynamic>>.from(d['list'] ?? []);
          if (list.isEmpty) return Text('该时段没有销售', style: t.bodyMedium);
          return Column(children: [
            for (final x in list.take(8))
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 5),
                child: Row(children: [
                  Expanded(
                    child: Text('${x['productName']}${(x['specText'] ?? '') != '' && x['specText'] != null ? ' ${x['specText']}' : ''}',
                        style: t.bodyLarge?.copyWith(fontSize: 14), overflow: TextOverflow.ellipsis),
                  ),
                  Text('${x['qty']}件', style: t.bodyMedium?.copyWith(fontSize: 12)),
                  SizedBox(width: 76, child: Text('¥${_money.format(x['amount'])}', textAlign: TextAlign.right, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700))),
                  SizedBox(
                      width: 66,
                      child: Text('利${_money.format(x['profit'])}',
                          textAlign: TextAlign.right,
                          style: TextStyle(fontSize: 11, color: (x['profit'] ?? 0) >= 0 ? AppColors.success : AppColors.error))),
                ]),
              ),
            if (list.length > 8)
              Padding(padding: const EdgeInsets.only(top: 4), child: Text('共 ${list.length} 种商品', style: t.bodyMedium?.copyWith(fontSize: 11))),
          ]);
        }),
      ]),
    );
  }
}

/// 热销分析：复用销售数据按销量排（不用再打一次后端）
class _HotCard extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = Theme.of(context).textTheme;
    return SoftCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const _SectionTitle('热销分析 · 按销量'),
        _loadErrEmpty(ref.watch(salesReportProvider), (d) {
          final list = List<Map<String, dynamic>>.from(d['list'] ?? [])
            ..sort((a, b) => (b['qty'] ?? 0).compareTo(a['qty'] ?? 0));
          if (list.isEmpty) return Text('该时段没有销售', style: t.bodyMedium);
          return Column(children: [
            for (final (i, x) in list.take(5).indexed)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 5),
                child: Row(children: [
                  SizedBox(
                      width: 24,
                      child: Text('${i + 1}',
                          style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: i < 3 ? AppColors.primary : AppColors.onSurfaceVariant))),
                  Expanded(
                      child: Text('${x['productName']}${(x['specText'] ?? '') != '' && x['specText'] != null ? ' ${x['specText']}' : ''}',
                          style: t.bodyLarge?.copyWith(fontSize: 14), overflow: TextOverflow.ellipsis)),
                  Text('${x['qty']}件', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
                ]),
              ),
          ]);
        }),
      ]),
    );
  }
}

/// 进货统计
class _PurchaseStatsCard extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = Theme.of(context).textTheme;
    return SoftCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const _SectionTitle('进货统计'),
        _loadErrEmpty(ref.watch(purchaseStatsProvider), (d) {
          final byProduct = List<Map<String, dynamic>>.from(d['byProduct'] ?? []);
          if (byProduct.isEmpty) return Text('该时段没有进货', style: t.bodyMedium);
          return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('共进货 ¥${_money.format(d['total'])} · ${d['orderCount']}单', style: t.bodyMedium?.copyWith(fontSize: 12)),
            const SizedBox(height: 6),
            for (final x in byProduct.take(5))
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(children: [
                  Expanded(child: Text(x['name'], style: t.bodyLarge?.copyWith(fontSize: 14), overflow: TextOverflow.ellipsis)),
                  Text('${x['qty']}件', style: t.bodyMedium?.copyWith(fontSize: 12)),
                  SizedBox(width: 80, child: Text('¥${_money.format(x['amount'])}', textAlign: TextAlign.right, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700))),
                ]),
              ),
          ]);
        }),
      ]),
    );
  }
}

/// 员工业绩
class _StaffCard extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = Theme.of(context).textTheme;
    return SoftCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const _SectionTitle('员工业绩'),
        _loadErrEmpty(ref.watch(staffPerfProvider), (d) {
          final list = List<Map<String, dynamic>>.from(d['list'] ?? []);
          if (list.isEmpty) return Text('该时段没有开单', style: t.bodyMedium);
          return Column(children: [
            for (final x in list)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(children: [
                  Expanded(child: Text(x['name'], style: t.bodyLarge?.copyWith(fontSize: 14))),
                  Text('${x['orders']}单', style: t.bodyMedium?.copyWith(fontSize: 12)),
                  SizedBox(width: 80, child: Text('¥${_money.format(x['sales'])}', textAlign: TextAlign.right, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700))),
                  SizedBox(
                      width: 64,
                      child: Text('利${_money.format(x['profit'])}',
                          textAlign: TextAlign.right,
                          style: TextStyle(fontSize: 11, color: (x['profit'] ?? 0) >= 0 ? AppColors.success : AppColors.error))),
                ]),
              ),
          ]);
        }),
      ]),
    );
  }
}

class _InventoryCard extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = Theme.of(context).textTheme;
    return SoftCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const _SectionTitle('库存统计（实时）'),
        _loadErrEmpty(ref.watch(inventoryReportProvider), (d) {
          final byType = List<Map<String, dynamic>>.from(d['byType'] ?? []);
          final low = List<Map<String, dynamic>>.from(d['lowStock'] ?? []);
          return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Text('¥${_money.format(d['totalValue'])}', style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w700)),
              const SizedBox(width: 8),
              Text('库存成本总值 · ${d['totalStock']}件', style: t.bodyMedium?.copyWith(fontSize: 12)),
            ]),
            const SizedBox(height: 8),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final x in byType) Chip(label: Text('${x['name']} ¥${_money.format(x['value'])}')),
            ]),
            if (low.isNotEmpty) ...[
              const SizedBox(height: 8),
              for (final x in low.take(5))
                Text('⚠ ${x['productName']}${(x['specText'] ?? '') != '' ? ' ${x['specText']}' : ''} 仅剩${x['stock']}（预警线${x['minQuantity']}）',
                    style: const TextStyle(fontSize: 12, color: AppColors.warning)),
            ],
          ]);
        }),
      ]),
    );
  }
}

class _CashflowCard extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = Theme.of(context).textTheme;
    final dt = DateFormat('MM-dd HH:mm');
    return SoftCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const _SectionTitle('资金流水'),
        _loadErrEmpty(ref.watch(cashflowReportProvider), (d) {
          final rows = List<Map<String, dynamic>>.from(d['rows'] ?? []);
          if (rows.isEmpty) return Text('该时段没有资金往来', style: t.bodyMedium);
          return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('流入 ¥${_money.format(d['inflow'])} · 流出 ¥${_money.format(d['outflow'])} · 净 ¥${_money.format(d['net'])}',
                style: t.bodyMedium?.copyWith(fontSize: 12)),
            const SizedBox(height: 6),
            for (final x in rows.take(8))
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(children: [
                  SizedBox(width: 40, child: Text(x['type'], style: t.bodyMedium?.copyWith(fontSize: 12))),
                  Expanded(child: Text(x['note'] ?? '', style: t.bodyLarge?.copyWith(fontSize: 13), overflow: TextOverflow.ellipsis)),
                  Text(dt.format(DateTime.parse(x['at']).toLocal()), style: t.bodyMedium?.copyWith(fontSize: 11)),
                  SizedBox(
                    width: 80,
                    child: Text(
                      '${(x['amount'] ?? 0) > 0 ? '+' : ''}${_money.format(x['amount'])}',
                      textAlign: TextAlign.right,
                      style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: (x['amount'] ?? 0) > 0 ? AppColors.success : AppColors.error),
                    ),
                  ),
                ]),
              ),
            if (rows.length > 8) Text('共 ${rows.length} 笔', style: t.bodyMedium?.copyWith(fontSize: 11)),
          ]);
        }),
      ]),
    );
  }
}
