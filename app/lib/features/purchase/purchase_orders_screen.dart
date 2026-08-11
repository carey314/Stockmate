import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';

final _dt = DateFormat('MM-dd HH:mm');

enum _PoFilter { all, owed, paid, cancelled }

/// 进货单列表：搜供应商/单号 + 状态筛选
class PurchaseOrdersScreen extends ConsumerStatefulWidget {
  const PurchaseOrdersScreen({super.key});

  @override
  ConsumerState<PurchaseOrdersScreen> createState() => _PurchaseOrdersScreenState();
}

class _PurchaseOrdersScreenState extends ConsumerState<PurchaseOrdersScreen> {
  String _query = '';
  _PoFilter _filter = _PoFilter.all;
  final _searchCtl = TextEditingController();

  @override
  void dispose() {
    _searchCtl.dispose();
    super.dispose();
  }

  bool _matches(PurchaseOrderSummary o) {
    final byFilter = switch (_filter) {
      _PoFilter.all => true,
      _PoFilter.owed => o.status != 'cancelled' && o.unpaidAmount > 0,
      _PoFilter.paid => o.status != 'cancelled' && o.unpaidAmount <= 0,
      _PoFilter.cancelled => o.status == 'cancelled',
    };
    if (!byFilter) return false;
    final q = _query.trim().toLowerCase();
    if (q.isEmpty) return true;
    return o.supplierName.toLowerCase().contains(q) || o.orderNo.toLowerCase().contains(q);
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final orders = ref.watch(purchaseOrdersProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('进货单')),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppColors.primary,
        onPressed: () async {
          await context.push('/purchase-orders/new');
          ref.invalidate(purchaseOrdersProvider);
        },
        icon: const Icon(Icons.add_rounded, color: Colors.white),
        label: const Text('进货', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.refresh(purchaseOrdersProvider.future),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(kPagePadding, 8, kPagePadding, 100),
          children: [
            TextField(
              controller: _searchCtl,
              onChanged: (v) => setState(() => _query = v),
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                hintText: '搜供应商 / 单号',
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
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(children: [
                for (final (f, label) in const [
                  (_PoFilter.all, '全部'),
                  (_PoFilter.owed, '欠供应商'),
                  (_PoFilter.paid, '已付清'),
                  (_PoFilter.cancelled, '已取消'),
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
                  final hasCondition = _query.isNotEmpty || _filter != _PoFilter.all;
                  return SoftCard(
                    child: Column(children: [
                      const Icon(Icons.local_shipping_outlined, size: 40, color: AppColors.outlineVariant),
                      const SizedBox(height: 10),
                      Text(hasCondition ? '没有匹配的进货单' : '还没有进货单', style: t.titleMedium),
                      const SizedBox(height: 4),
                      Text(hasCondition ? '换个条件试试' : '点右下角「进货」开第一张单，提交即入库',
                          style: t.bodyMedium, textAlign: TextAlign.center),
                    ]),
                  );
                }
                final owedTotal = _filter == _PoFilter.owed ? filtered.fold(0.0, (s, o) => s + o.unpaidAmount) : 0.0;
                return Column(children: [
                  if (_filter == _PoFilter.owed)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: SoftCard(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                        child: Row(children: [
                          const Icon(Icons.error_outline_rounded, size: 18, color: AppColors.warning),
                          const SizedBox(width: 8),
                          Text('${filtered.length} 张单未付清，共欠 ¥${owedTotal.toStringAsFixed(owedTotal == owedTotal.roundToDouble() ? 0 : 1)}',
                              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.warning)),
                        ]),
                      ),
                    ),
                  for (final o in filtered)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: SoftCard(
                        padding: const EdgeInsets.all(16),
                        onTap: () async {
                          await context.push('/purchase-orders/${o.id}');
                          ref.invalidate(purchaseOrdersProvider);
                        },
                        child: Row(children: [
                          Expanded(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text(o.supplierName, style: t.titleMedium),
                              const SizedBox(height: 2),
                              Text('${o.orderNo} · ${o.itemCount}种商品 · ${_dt.format(o.createdAt)}',
                                  style: t.bodyMedium?.copyWith(fontSize: 12)),
                            ]),
                          ),
                          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                            Text('¥${o.actualAmount}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                            Text(
                              o.status == 'cancelled'
                                  ? '已取消'
                                  : o.unpaidAmount > 0
                                      ? '欠供应商 ¥${o.unpaidAmount}'
                                      : '已付清',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: o.unpaidAmount > 0 ? FontWeight.w700 : FontWeight.w400,
                                color: o.status == 'cancelled'
                                    ? AppColors.onSurfaceVariant
                                    : o.unpaidAmount > 0
                                        ? AppColors.warning
                                        : AppColors.success,
                              ),
                            ),
                          ]),
                        ]),
                      ),
                    ),
                ]);
              },
            ),
          ],
        ),
      ),
    );
  }
}
