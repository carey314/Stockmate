import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';

final _dt = DateFormat('MM-dd HH:mm');

/// 订单状态筛选：全部 / 欠款 / 已结清 / 已取消
enum _OrderFilter { all, owed, settled, cancelled }

class OrdersScreen extends ConsumerStatefulWidget {
  const OrdersScreen({super.key});

  @override
  ConsumerState<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends ConsumerState<OrdersScreen> {
  String _query = '';
  _OrderFilter _filter = _OrderFilter.all;
  final _searchCtl = TextEditingController();

  @override
  void dispose() {
    _searchCtl.dispose();
    super.dispose();
  }

  bool _matches(OrderSummary o) {
    final byFilter = switch (_filter) {
      _OrderFilter.all => true,
      _OrderFilter.owed => o.status == 'completed' && o.unpaidAmount > 0,
      _OrderFilter.settled => o.status == 'completed' && o.unpaidAmount <= 0,
      _OrderFilter.cancelled => o.status == 'cancelled',
    };
    if (!byFilter) return false;
    final q = _query.trim().toLowerCase();
    if (q.isEmpty) return true;
    return o.customerName.toLowerCase().contains(q) || o.orderNo.toLowerCase().contains(q);
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final orders = ref.watch(ordersProvider);

    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppColors.primary,
        onPressed: () => context.push('/orders/new'),
        icon: const Icon(Icons.add_rounded, color: Colors.white),
        label: const Text('开单', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.refresh(ordersProvider.future),
        child: CustomScrollView(slivers: [
          const AppLargeTitleBar('订单'),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(kPagePadding, 0, kPagePadding, 120),
            sliver: SliverList.list(children: [
            // 搜索：客户名 / 单号
            TextField(
              controller: _searchCtl,
              onChanged: (v) => setState(() => _query = v),
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                hintText: '搜客户名 / 单号',
                prefixIcon: const Icon(Icons.search_rounded, color: AppColors.onSurfaceVariant),
                suffixIcon: _query.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.close_rounded, size: 18, color: AppColors.onSurfaceVariant),
                        onPressed: () => setState(() {
                          _searchCtl.clear();
                          _query = '';
                        }),
                      ),
                isDense: true,
                filled: true,
                fillColor: Colors.white,
                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
              ),
            ),
            const SizedBox(height: 12),
            // 状态筛选
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(children: [
                for (final (f, label) in const [
                  (_OrderFilter.all, '全部'),
                  (_OrderFilter.owed, '欠款'),
                  (_OrderFilter.settled, '已结清'),
                  (_OrderFilter.cancelled, '已取消'),
                ]) ...[
                  ChoiceChip(
                    label: Text(label),
                    selected: _filter == f,
                    onSelected: (_) => setState(() => _filter = f),
                  ),
                  const SizedBox(width: 8),
                ],
              ]),
            ),
            const SizedBox(height: 16),
            orders.when(
              loading: () => const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator())),
              error: (e, _) => SoftCard(child: Text('加载失败：$e')),
              data: (list) {
                final filtered = list.where(_matches).toList();
                if (filtered.isEmpty) {
                  final hasCondition = _query.isNotEmpty || _filter != _OrderFilter.all;
                  return SoftCard(
                    child: Column(children: [
                      const Icon(Icons.receipt_long_outlined, size: 40, color: AppColors.outlineVariant),
                      const SizedBox(height: 10),
                      Text(hasCondition ? '没有匹配的订单，换个条件试试' : '还没有订单，点右下角开单', style: t.bodyMedium),
                    ]),
                  );
                }
                // 欠款筛选下给合计，方便催账
                final owedTotal = _filter == _OrderFilter.owed ? filtered.fold(0.0, (s, o) => s + o.unpaidAmount) : 0.0;
                return Column(children: [
                  if (_filter == _OrderFilter.owed)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: SoftCard(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                        child: Row(children: [
                          const Icon(Icons.error_outline_rounded, size: 18, color: AppColors.warning),
                          const SizedBox(width: 8),
                          Text('${filtered.length} 张单未结清，共欠 ¥${owedTotal.toStringAsFixed(owedTotal == owedTotal.roundToDouble() ? 0 : 1)}',
                              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.warning)),
                        ]),
                      ),
                    ),
                  for (final o in filtered)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: SoftCard(
                        padding: const EdgeInsets.all(16),
                        onTap: () => context.push('/orders/${o.id}'),
                        child: Row(children: [
                          Expanded(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text(o.customerName, style: t.titleMedium),
                              const SizedBox(height: 2),
                              Text('${o.orderNo} · ${o.itemCount}种商品 · ${_dt.format(o.createdAt)}',
                                  style: t.bodyMedium?.copyWith(fontSize: 12)),
                            ]),
                          ),
                          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                            Text('¥${o.actualAmount}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                            Text(
                              o.status == 'completed' && o.unpaidAmount > 0
                                  ? '欠 ¥${o.unpaidAmount}'
                                  : switch (o.status) { 'completed' => '已结清', 'cancelled' => '已取消', _ => '草稿' },
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: o.unpaidAmount > 0 ? FontWeight.w700 : FontWeight.w400,
                                color: o.status == 'completed' && o.unpaidAmount > 0
                                    ? AppColors.warning
                                    : switch (o.status) {
                                        'completed' => AppColors.success,
                                        'cancelled' => AppColors.onSurfaceVariant,
                                        _ => AppColors.warning
                                      },
                              ),
                            ),
                          ]),
                        ]),
                      ),
                    ),
                ]);
              },
            ),
            ]),
          ),
        ]),
      ),
    );
  }
}
