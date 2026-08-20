import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../core/api.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';

final _money = NumberFormat('#,##0.##');
final _dt = DateFormat('MM-dd HH:mm');

/// 客户列表：按欠款降序——催账是这个页面存在的第一理由。
/// 原来客户管理是「我的」里的一个 bottom sheet，只能看名字电话；
/// 欠款、历史单、对账单、专属价全都有接口，缺的只是把它们聚起来的入口。
class CustomersScreen extends ConsumerStatefulWidget {
  const CustomersScreen({super.key});

  @override
  ConsumerState<CustomersScreen> createState() => _CustomersScreenState();
}

class _CustomersScreenState extends ConsumerState<CustomersScreen> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final customers = ref.watch(customersProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('客户')),
      floatingActionButton: FloatingActionButton(
        backgroundColor: AppColors.primary,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        onPressed: () async {
          await _editCustomer(context, ref, null);
        },
        child: const Icon(Icons.person_add_alt_1_rounded, color: Colors.white),
      ),
      body: customers.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('$e')),
        data: (list) {
          var rows = [...list]..sort((a, b) {
              final byOwed = b.owed.compareTo(a.owed);
              return byOwed != 0 ? byOwed : a.name.compareTo(b.name);
            });
          if (_q.trim().isNotEmpty) {
            rows = rows.where((c) => c.name.contains(_q.trim()) || (c.phone ?? '').contains(_q.trim())).toList();
          }
          final totalOwed = list.fold<double>(0, (s, c) => s + c.owed);
          return RefreshIndicator(
            onRefresh: () async => ref.refresh(customersProvider.future),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(kPagePadding, 8, kPagePadding, 120),
              children: [
                if (list.length > 6)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: TextField(
                      onChanged: (v) => setState(() => _q = v),
                      decoration: InputDecoration(
                        hintText: '搜客户名 / 电话',
                        prefixIcon: const Icon(Icons.search_rounded, color: AppColors.onSurfaceVariant),
                        isDense: true,
                        filled: true,
                        fillColor: Colors.white,
                        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
                      ),
                    ),
                  ),
                if (totalOwed > 0)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: SoftCard(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                      child: Row(children: [
                        const Icon(Icons.account_balance_wallet_outlined, size: 18, color: AppColors.warning),
                        const SizedBox(width: 8),
                        Text('外面共欠你 ¥${_money.format(totalOwed)}',
                            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.warning)),
                      ]),
                    ),
                  ),
                if (rows.isEmpty)
                  SoftCard(
                    child: Column(children: [
                      const Icon(Icons.people_outline_rounded, size: 40, color: AppColors.outlineVariant),
                      const SizedBox(height: 10),
                      Text(_q.isEmpty ? '还没有客户，点右下角添加' : '没有匹配的客户', style: t.bodyMedium),
                    ]),
                  ),
                for (final c in rows)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: SoftCard(
                      onTap: () async {
                        await context.push('/customers/${c.id}');
                        ref.invalidate(customersProvider);
                      },
                      child: Row(children: [
                        CircleAvatar(
                          backgroundColor: AppColors.primaryFixed,
                          child: Text(c.name.characters.first, style: const TextStyle(color: AppColors.primary, fontWeight: FontWeight.w700)),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(c.name, style: t.titleMedium),
                            if (c.phone != null) Text(c.phone!, style: t.bodyMedium?.copyWith(fontSize: 12)),
                          ]),
                        ),
                        if (c.owed > 0)
                          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                            Text('欠 ¥${_money.format(c.owed)}',
                                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppColors.warning)),
                            Text('${c.unpaidCount} 张未清', style: const TextStyle(fontSize: 11, color: AppColors.onSurfaceVariant)),
                          ])
                        else
                          const Icon(Icons.chevron_right_rounded, color: AppColors.onSurfaceVariant),
                      ]),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// 新建/编辑客户（列表 FAB 和详情页共用）
Future<Customer?> _editCustomer(BuildContext context, WidgetRef ref, Customer? existing) async {
  final name = TextEditingController(text: existing?.name ?? '');
  final phone = TextEditingController(text: existing?.phone ?? '');
  final address = TextEditingController(text: existing?.address ?? '');
  final notes = TextEditingController(text: existing?.notes ?? '');
  int? typeId = existing?.productTypeId;
  final types = await ref.read(typesProvider.future);
  if (!context.mounted) return null;
  final ok = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setModal) => Padding(
        padding: EdgeInsets.fromLTRB(24, 24, 24, MediaQuery.of(ctx).viewInsets.bottom + 24),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(existing == null ? '新客户' : '编辑客户', style: Theme.of(ctx).textTheme.headlineMedium),
          const SizedBox(height: 14),
          TextField(controller: name, autofocus: existing == null, decoration: const InputDecoration(labelText: '客户名称 *')),
          const SizedBox(height: 10),
          TextField(controller: phone, decoration: const InputDecoration(labelText: '电话')),
          const SizedBox(height: 10),
          TextField(controller: address, decoration: const InputDecoration(labelText: '地址（送货用）')),
          const SizedBox(height: 10),
          TextField(controller: notes, decoration: const InputDecoration(labelText: '备注')),
          const SizedBox(height: 14),
          const Text('主营品类（开单只显示该品类商品）', style: TextStyle(fontSize: 12)),
          const SizedBox(height: 8),
          Wrap(spacing: 6, runSpacing: 6, children: [
            ChoiceChip(label: const Text('不限'), selected: typeId == null, onSelected: (_) => setModal(() => typeId = null)),
            for (final tp in types)
              ChoiceChip(label: Text(tp.name), selected: typeId == tp.id, onSelected: (_) => setModal(() => typeId = tp.id)),
          ]),
          const SizedBox(height: 16),
          SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('保存'))),
        ]),
      ),
    ),
  );
  if (ok != true || name.text.trim().isEmpty) return null;
  final body = {
    'name': name.text.trim(),
    'phone': phone.text.trim().isEmpty ? null : phone.text.trim(),
    'address': address.text.trim().isEmpty ? null : address.text.trim(),
    'notes': notes.text.trim().isEmpty ? null : notes.text.trim(),
    'productTypeId': typeId,
  };
  try {
    final data = existing == null
        ? await Api.I.post('/customers', data: body)
        : await Api.I.put('/customers/${existing.id}', data: body);
    ref.invalidate(customersProvider);
    return Customer.fromJson(data);
  } catch (e) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    return null;
  }
}

/// 客户详情：欠款汇总 + 未清单据（点进去收款）+ 历史单 + 对账单/专属价入口 + 档案编辑删除
class CustomerDetailScreen extends ConsumerStatefulWidget {
  final int customerId;
  const CustomerDetailScreen({super.key, required this.customerId});

  @override
  ConsumerState<CustomerDetailScreen> createState() => _CustomerDetailScreenState();
}

class _CustomerDetailScreenState extends ConsumerState<CustomerDetailScreen> {
  Customer? _c;
  List<OrderSummary> _orders = [];
  List<Map<String, dynamic>> _prices = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final results = await Future.wait([
        Api.I.get('/customers/${widget.customerId}'),
        Api.I.get('/orders', query: {'customerId': widget.customerId, 'pageSize': 50}),
        Api.I.get('/customers/${widget.customerId}/prices'),
      ]);
      if (!mounted) return;
      setState(() {
        _c = Customer.fromJson(Map<String, dynamic>.from(results[0]));
        _orders = (results[1]['list'] as List).map((x) => OrderSummary.fromJson(x)).toList();
        _prices = List<Map<String, dynamic>>.from(results[2] ?? []);
      });
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  double get _owed => _orders
      .where((o) => o.status == 'completed' && o.unpaidAmount > 0)
      .fold(0.0, (s, o) => s + o.unpaidAmount);

  Future<void> _delete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dctx) => AlertDialog(
        title: Text('删除「${_c!.name}」？'),
        content: const Text('历史订单和对账数据会保留，只是客户档案不再显示。'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dctx, false), child: const Text('取消')),
          TextButton(onPressed: () => Navigator.pop(dctx, true), child: const Text('删除', style: TextStyle(color: AppColors.error))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.I.delete('/customers/${widget.customerId}');
      ref.invalidate(customersProvider);
      if (mounted && context.canPop()) context.pop();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final c = _c;
    final unpaid = _orders.where((o) => o.status == 'completed' && o.unpaidAmount > 0).toList();
    final history = _orders.where((o) => !(o.status == 'completed' && o.unpaidAmount > 0)).take(10).toList();
    return Scaffold(
      appBar: AppBar(title: Text(c?.name ?? '客户'), actions: [
        if (c != null)
          PopupMenuButton<String>(
            onSelected: (v) async {
              if (v == 'edit') {
                final updated = await _editCustomer(context, ref, c);
                if (updated != null) _load();
              }
              if (v == 'del') _delete();
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'edit', child: Text('编辑档案')),
              PopupMenuItem(value: 'del', child: Text('删除客户', style: TextStyle(color: AppColors.error))),
            ],
          ),
      ]),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : c == null
              ? const Center(child: Text('加载失败'))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(kPagePadding, 8, kPagePadding, 40),
                    children: [
                      // 档案 + 欠款
                      SoftCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            CircleAvatar(
                              radius: 24,
                              backgroundColor: AppColors.primaryFixed,
                              child: Text(c.name.characters.first,
                                  style: const TextStyle(fontSize: 20, color: AppColors.primary, fontWeight: FontWeight.w700)),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(c.name, style: t.titleLarge),
                                Text([c.phone, c.address].where((x) => x != null && x.isNotEmpty).join(' · '),
                                    style: t.bodyMedium?.copyWith(fontSize: 12)),
                              ]),
                            ),
                            if (_owed > 0)
                              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                                Text('¥${_money.format(_owed)}',
                                    style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: AppColors.warning)),
                                const Text('当前欠款', style: TextStyle(fontSize: 11, color: AppColors.onSurfaceVariant)),
                              ]),
                          ]),
                          const SizedBox(height: 12),
                          Row(children: [
                            Expanded(
                              child: OutlinedButton.icon(
                                onPressed: () => context.push('/reports/statement/${c.id}'),
                                icon: const Icon(Icons.receipt_long_rounded, size: 16),
                                label: const Text('对账单', style: TextStyle(fontSize: 13)),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: FilledButton.icon(
                                onPressed: () => context.push('/orders/new?customer=${c.id}'),
                                icon: const Icon(Icons.add_rounded, size: 16),
                                label: const Text('开单', style: TextStyle(fontSize: 13)),
                              ),
                            ),
                          ]),
                        ]),
                      ),
                      // 未清单据：催账主战场，一单一行点进去收款
                      if (unpaid.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        Text('未结清（${unpaid.length} 张）', style: t.titleMedium),
                        const SizedBox(height: 8),
                        for (final o in unpaid)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: SoftCard(
                              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                              onTap: () async {
                                await context.push('/orders/${o.id}');
                                _load();
                              },
                              child: Row(children: [
                                Expanded(
                                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Text(o.orderNo, style: t.titleMedium?.copyWith(fontSize: 14)),
                                    Text(_dt.format(o.createdAt), style: t.bodyMedium?.copyWith(fontSize: 11)),
                                  ]),
                                ),
                                Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                                  Text('欠 ¥${_money.format(o.unpaidAmount)}',
                                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.warning)),
                                  const Text('点进去收款 →', style: TextStyle(fontSize: 10, color: AppColors.onSurfaceVariant)),
                                ]),
                              ]),
                            ),
                          ),
                      ],
                      // 专属价
                      if (_prices.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        Text('专属价（${_prices.length}）', style: t.titleMedium),
                        const SizedBox(height: 8),
                        SoftCard(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                          child: Column(children: [
                            for (final p in _prices)
                              Padding(
                                padding: const EdgeInsets.symmetric(vertical: 6),
                                child: Row(children: [
                                  Expanded(
                                    child: Text(
                                      '${p['product']?['name'] ?? ''}${(p['sku']?['specText'] ?? '') != '' ? ' ${p['sku']['specText']}' : ''}',
                                      style: const TextStyle(fontSize: 13),
                                    ),
                                  ),
                                  Text('¥${p['price']}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.primary)),
                                ]),
                              ),
                          ]),
                        ),
                      ],
                      // 最近订单
                      if (history.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        Text('最近订单', style: t.titleMedium),
                        const SizedBox(height: 8),
                        for (final o in history)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: SoftCard(
                              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                              onTap: () => context.push('/orders/${o.id}'),
                              child: Row(children: [
                                Expanded(child: Text('${o.orderNo} · ${_dt.format(o.createdAt)}', style: t.bodyMedium?.copyWith(fontSize: 12))),
                                Text('¥${_money.format(o.actualAmount)}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
                                const SizedBox(width: 6),
                                Text(o.status == 'cancelled' ? '已取消' : '已结清',
                                    style: TextStyle(fontSize: 11, color: o.status == 'cancelled' ? AppColors.onSurfaceVariant : AppColors.success)),
                              ]),
                            ),
                          ),
                      ],
                    ],
                  ),
                ),
    );
  }
}
