import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/api.dart';
import '../../core/theme.dart';
import 'notice_settings_screen.dart';

/// 通知 = 待办，不是日志（docs/notification-design.md P1）
/// 实时聚合现有接口，零后端改动；已读状态存本地（内容指纹变了自动重新变未读）
class NotifyItem {
  final String key; // 内容指纹：内容变化 → key 变化 → 重新未读
  final IconData icon;
  final Color color;
  final String title;
  final String body;
  final String route;
  const NotifyItem({required this.key, required this.icon, required this.color, required this.title, required this.body, required this.route});
}

/// 聚合四类动态提醒
final notifyItemsProvider = FutureProvider.autoDispose<List<NotifyItem>>((ref) async {
  final items = <NotifyItem>[];
  final today = DateFormat('yyyy-MM-dd').format(DateTime.now());

  // 1. 库存预警（合并为一条）
  try {
    final alerts = List<Map<String, dynamic>>.from(await Api.I.get('/inventory/alerts'));
    if (alerts.isNotEmpty) {
      final names = alerts
          .map((a) => '${a['sku']?['product']?['name'] ?? ''}${(a['sku']?['specText'] ?? '') != '' ? '(${a['sku']['specText']})' : ''}')
          .where((s) => s.isNotEmpty)
          .toList();
      final top = names.take(3).join('、');
      items.add(NotifyItem(
        key: 'low-stock:${alerts.length}:${names.take(3).join(',')}',
        icon: Icons.inventory_2_outlined,
        color: AppColors.error,
        title: '${alerts.length} 个商品该补货了',
        body: '$top${names.length > 3 ? ' 等' : ''}已到预警线',
        route: '/products',
      ));
    }
  } catch (_) {}

  // 2. 客户欠我（合并）
  try {
    final d = await Api.I.get('/orders?pageSize=200');
    final list = List<Map<String, dynamic>>.from(d is Map ? d['list'] : d);
    final owed = list.where((o) => o['status'] == 'completed' && ((o['unpaidAmount'] ?? 0) as num) > 0).toList();
    if (owed.isNotEmpty) {
      final total = owed.fold<double>(0, (s, o) => s + (o['unpaidAmount'] as num).toDouble());
      final customers = owed.map((o) => o['customer']?['name'] ?? '').toSet()..remove('');
      items.add(NotifyItem(
        key: 'owed:${owed.length}:${total.toStringAsFixed(1)}',
        icon: Icons.account_balance_wallet_outlined,
        color: AppColors.warning,
        title: '${customers.length} 家客户共欠你 ¥${_fmt(total)}',
        body: '${owed.length} 张单未结清，点进去按「欠款」筛选逐单催收',
        route: '/orders',
      ));
    }
  } catch (_) {}

  // 3. 我欠供应商（合并）
  try {
    final d = await Api.I.get('/purchase-orders?pageSize=200');
    final list = List<Map<String, dynamic>>.from(d is Map ? d['list'] : d);
    final owed = list.where((o) => o['status'] != 'cancelled' && ((o['unpaidAmount'] ?? 0) as num) > 0).toList();
    if (owed.isNotEmpty) {
      final total = owed.fold<double>(0, (s, o) => s + (o['unpaidAmount'] as num).toDouble());
      items.add(NotifyItem(
        key: 'payable:${owed.length}:${total.toStringAsFixed(1)}',
        icon: Icons.local_shipping_outlined,
        color: AppColors.warning,
        title: '欠供应商 ¥${_fmt(total)} 未付',
        body: '${owed.length} 张进货单未付清',
        route: '/purchase-orders',
      ));
    }
  } catch (_) {}

  // 4. 今日小结（当天有生意才出现）
  try {
    final o = await Api.I.get('/stats/overview');
    final orders = o['todayOrderCount'] ?? 0;
    if (orders > 0) {
      final sales = (o['todaySales'] ?? 0).toDouble();
      final profit = (o['todayProfit'] ?? 0).toDouble();
      items.add(NotifyItem(
        key: 'daily:$today:$orders:${sales.toStringAsFixed(1)}',
        icon: Icons.auto_graph_rounded,
        color: AppColors.primary,
        title: '今日小结：$orders 单 · 销售 ¥${_fmt(sales)}',
        body: '毛利 ¥${_fmt(profit)}，点看完整报表',
        route: '/reports',
      ));
    }
  } catch (_) {}

  return items;
});

String _fmt(double v) => v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toStringAsFixed(1);

/// 已读指纹存本地
class _ReadStore {
  static const _k = 'notify_read_keys';
  static Future<Set<String>> load() async {
    final sp = await SharedPreferences.getInstance();
    return (sp.getStringList(_k) ?? []).toSet();
  }

  static Future<void> markRead(Iterable<String> keys) async {
    final sp = await SharedPreferences.getInstance();
    final cur = (sp.getStringList(_k) ?? []).toSet()..addAll(keys);
    // 只保留最近200个指纹，防无限增长
    await sp.setStringList(_k, cur.toList().reversed.take(200).toList());
  }
}

/// 首页铃铛红点：有任一未读项即亮
final hasUnreadProvider = FutureProvider.autoDispose<bool>((ref) async {
  final items = await ref.watch(notifyItemsProvider.future);
  final read = await _ReadStore.load();
  return items.any((i) => !read.contains(i.key));
});

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  Set<String> _read = {};

  @override
  void initState() {
    super.initState();
    _ReadStore.load().then((r) {
      if (mounted) setState(() => _read = r);
    });
  }

  Future<void> _markRead(NotifyItem item) async {
    await _ReadStore.markRead([item.key]);
    setState(() => _read = {..._read, item.key});
    ref.invalidate(hasUnreadProvider);
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final items = ref.watch(notifyItemsProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('通知'),
        actions: [
          IconButton(
            tooltip: '提醒设置',
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const NoticeSettingsScreen()),
            ),
          ),
          items.maybeWhen(
            data: (list) => list.any((i) => !_read.contains(i.key))
                ? TextButton(
                    onPressed: () async {
                      await _ReadStore.markRead(list.map((i) => i.key));
                      setState(() => _read = {..._read, ...list.map((i) => i.key)});
                      ref.invalidate(hasUnreadProvider);
                    },
                    child: const Text('全部已读'),
                  )
                : const SizedBox.shrink(),
            orElse: () => const SizedBox.shrink(),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.refresh(notifyItemsProvider.future),
        child: items.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => Center(child: Text('$e')),
          data: (list) => list.isEmpty
              ? ListView(children: [
                  const SizedBox(height: 160),
                  const Icon(Icons.notifications_off_outlined, size: 56, color: AppColors.outlineVariant),
                  const SizedBox(height: 12),
                  Center(child: Text('没有需要处理的事', style: t.titleMedium)),
                  const SizedBox(height: 4),
                  Center(child: Text('库存预警、客户欠款、今日小结都会出现在这里', style: t.bodyMedium?.copyWith(fontSize: 12))),
                ])
              : ListView(
                  padding: const EdgeInsets.fromLTRB(kPagePadding, 12, kPagePadding, 40),
                  children: [
                    for (final n in list)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: SoftCard(
                          onTap: () {
                            _markRead(n);
                            context.push(n.route);
                          },
                          child: Row(children: [
                            Container(
                              width: 44,
                              height: 44,
                              decoration: BoxDecoration(color: n.color.withValues(alpha: .1), borderRadius: BorderRadius.circular(12)),
                              child: Icon(n.icon, color: n.color, size: 22),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Row(children: [
                                  Flexible(child: Text(n.title, style: t.titleMedium)),
                                  if (!_read.contains(n.key))
                                    Container(
                                      margin: const EdgeInsets.only(left: 6),
                                      width: 8,
                                      height: 8,
                                      decoration: const BoxDecoration(color: AppColors.error, shape: BoxShape.circle),
                                    ),
                                ]),
                                const SizedBox(height: 2),
                                Text(n.body, style: t.bodyMedium?.copyWith(fontSize: 12)),
                              ]),
                            ),
                            const Icon(Icons.chevron_right_rounded, color: AppColors.onSurfaceVariant),
                          ]),
                        ),
                      ),
                  ],
                ),
        ),
      ),
    );
  }
}
