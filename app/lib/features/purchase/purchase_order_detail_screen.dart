import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../../core/share_util.dart';
import '../../core/api.dart';
import '../../core/printer_service.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';

final _dt = DateFormat('yyyy-MM-dd HH:mm');
final _money = NumberFormat('#,##0.##');

/// 进货单详情：票据样式 + 分享 + 退货给供应商 + 付欠款
class PurchaseOrderDetailScreen extends ConsumerStatefulWidget {
  final int poId;
  const PurchaseOrderDetailScreen({super.key, required this.poId});

  @override
  ConsumerState<PurchaseOrderDetailScreen> createState() => _PurchaseOrderDetailScreenState();
}

class _PurchaseOrderDetailScreenState extends ConsumerState<PurchaseOrderDetailScreen> {
  final _key = GlobalKey();
  Map<String, dynamic>? _po;
  bool _sharing = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await Api.I.get('/purchase-orders/${widget.poId}');
      if (mounted) setState(() => _po = Map<String, dynamic>.from(data));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  void _toast(String m) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  bool _hasReturnable(Map<String, dynamic> o) =>
      (o['items'] as List? ?? []).any((it) => (it['quantity'] ?? 0) - (it['returnedQty'] ?? 0) > 0);

  Future<void> _share() async {
    if (_sharing || _po == null) return;
    setState(() => _sharing = true);
    try {
      final boundary = _key.currentContext!.findRenderObject() as RenderRepaintBoundary;
      final image = await boundary.toImage(pixelRatio: 3.0);
      final bytes = (await image.toByteData(format: ui.ImageByteFormat.png))!.buffer.asUint8List();
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/进货单_${_po!['orderNo']}.png');
      await file.writeAsBytes(bytes);
      if (mounted) await shareFiles(context, [XFile(file.path)], text: '进货单 ${_po!['orderNo']}');
      await Api.I.put('/purchase-orders/${widget.poId}/printed');
    } catch (e) {
      _toast('分享失败：$e');
    } finally {
      if (mounted) setState(() => _sharing = false);
    }
  }

  /// 付欠款
  Future<void> _pay() async {
    final o = _po!;
    final unpaid = (o['unpaidAmount'] ?? 0).toDouble();
    final amount = TextEditingController(text: unpaid.toString());
    String? account;
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModal) => Padding(
          padding: EdgeInsets.fromLTRB(24, 24, 24, MediaQuery.of(ctx).viewInsets.bottom + 32),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('付欠款（欠 ¥${_money.format(unpaid)}）', style: Theme.of(ctx).textTheme.headlineMedium),
            const SizedBox(height: 16),
            TextField(controller: amount, autofocus: true, keyboardType: TextInputType.number, decoration: const InputDecoration(hintText: '付款金额 ¥')),
            const SizedBox(height: 12),
            Wrap(spacing: 8, children: [
              for (final a in ['现金', '微信', '支付宝', '银行卡'])
                ChoiceChip(label: Text(a), selected: account == a, onSelected: (_) => setModal(() => account = a)),
            ]),
            const SizedBox(height: 16),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('确认付款')),
          ]),
        ),
      ),
    );
    if (ok != true) return;
    final v = double.tryParse(amount.text);
    if (v == null || v <= 0) return;
    try {
      await Api.I.post('/purchase-orders/${widget.poId}/pay', data: {'amount': v, if (account != null) 'settlementAccount': account});
      ref.invalidate(purchaseOrdersProvider);
      await _load();
      _toast('✓ 已付款 ¥$v');
    } catch (e) {
      _toast('$e');
    }
  }

  /// 退货给供应商
  Future<void> _returnItems() async {
    final o = _po!;
    final items = List<Map<String, dynamic>>.from(o['items'] ?? []);
    final qtys = <int, int>{};
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModal) {
          double v = 0;
          for (final it in items) {
            v += (qtys[it['id']] ?? 0) * (it['unitPrice'] ?? 0);
          }
          return SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('退货给供应商', style: Theme.of(ctx).textTheme.headlineMedium),
                const SizedBox(height: 4),
                Text('自动扣库存、冲减应付，多付的钱记退回款', style: Theme.of(ctx).textTheme.bodyMedium),
                const SizedBox(height: 14),
                for (final it in items)
                  Builder(builder: (_) {
                    final returnable = (it['quantity'] ?? 0) - (it['returnedQty'] ?? 0) as int;
                    final q = qtys[it['id']] ?? 0;
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(children: [
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('${it['productName']}${(it['specText'] ?? '') != '' && it['specText'] != null ? ' ${it['specText']}' : ''}',
                                style: Theme.of(ctx).textTheme.titleMedium),
                            Text('进价¥${it['unitPrice']} · 可退 $returnable', style: const TextStyle(fontSize: 12, color: AppColors.onSurfaceVariant)),
                          ]),
                        ),
                        IconButton(icon: const Icon(Icons.remove_circle_outline, size: 22), onPressed: q > 0 ? () => setModal(() => qtys[it['id']] = q - 1) : null),
                        Text('$q', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                        IconButton(icon: const Icon(Icons.add_circle_outline, size: 22), onPressed: q < returnable ? () => setModal(() => qtys[it['id']] = q + 1) : null),
                      ]),
                    );
                  }),
                const SizedBox(height: 10),
                FilledButton(onPressed: v > 0 ? () => Navigator.pop(ctx, true) : null, child: Text(v > 0 ? '确认退货 ¥${_money.format(v)}' : '选择退货数量')),
              ]),
            ),
          );
        },
      ),
    );
    if (confirmed != true) return;
    final payload = [
      for (final e in qtys.entries)
        if (e.value > 0) {'itemId': e.key, 'quantity': e.value}
    ];
    if (payload.isEmpty) return;
    try {
      final r = await Api.I.post('/purchase-orders/${widget.poId}/return', data: {'items': payload});
      ref.invalidate(purchaseOrdersProvider);
      invalidateProducts(ref);
      await _load();
      _toast('✓ 已退货，冲减应付 ¥${r['returnValue']}');
    } catch (e) {
      _toast('$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final o = _po;
    final unpaid = o == null ? 0.0 : (o['unpaidAmount'] ?? 0).toDouble();
    return Scaffold(
      appBar: AppBar(title: Text(o?['orderNo'] ?? '进货单')),
      bottomNavigationBar: o == null
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
                child: Row(children: [
                  if (o['status'] == 'completed' && _hasReturnable(o))
                    Expanded(child: OutlinedButton(onPressed: _returnItems, child: const Text('退货'))),
                  if (o['status'] == 'completed' && _hasReturnable(o)) const SizedBox(width: 8),
                  if (o['status'] == 'completed' && unpaid > 0)
                    Expanded(child: OutlinedButton(onPressed: _pay, child: Text('付欠款 ¥${_money.format(unpaid)}', style: const TextStyle(fontSize: 13)))),
                  if (o['status'] == 'completed' && unpaid > 0) const SizedBox(width: 8),
                  OutlinedButton(
                    onPressed: () async {
                      await PrinterService.I.printReceipt(context, _key);
                      Api.I.put('/purchase-orders/${widget.poId}/printed').ignore();
                    },
                    style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 12), minimumSize: const Size(48, 48)),
                    child: const Icon(Icons.print_outlined, size: 18),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: _sharing ? null : _share,
                      icon: _sharing
                          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : const Icon(Icons.ios_share_rounded, size: 18),
                      label: const Text('分享'),
                    ),
                  ),
                ]),
              ),
            ),
      body: o == null
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(kPagePadding, 12, kPagePadding, 24),
              child: RepaintBoundary(key: _key, child: _PoReceipt(po: o)),
            ),
    );
  }
}

class _PoReceipt extends ConsumerWidget {
  final Map<String, dynamic> po;
  const _PoReceipt({required this.po});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final o = po;
    final items = List<Map<String, dynamic>>.from(o['items'] ?? []);
    final supplier = o['supplier'];
    final unpaid = (o['unpaidAmount'] ?? 0).toDouble();
    final shopName = ref.watch(profileProvider).valueOrNull?['shopName'] ?? '进货单';
    const label = TextStyle(fontSize: 11, color: Color(0xFF888888));
    const value = TextStyle(fontSize: 12, color: Color(0xFF222222));

    return Container(
      color: Colors.white,
      padding: const EdgeInsets.all(20),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Center(
          child: Column(children: [
            Text(shopName, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: Colors.black)),
            const SizedBox(height: 2),
            const Text('进 货 单', style: TextStyle(fontSize: 13, letterSpacing: 6, color: Color(0xFF555555))),
          ]),
        ),
        const SizedBox(height: 14),
        Row(children: [
          Expanded(child: Text('单号：${o['orderNo']}', style: value)),
          Text('日期：${_dt.format(DateTime.parse(o['createdAt']).toLocal())}', style: value),
        ]),
        const SizedBox(height: 4),
        Row(children: [
          Expanded(child: Text('供应商：${supplier?['name'] ?? '-'}', style: value)),
          if ((supplier?['phone'] ?? '') != '' && supplier?['phone'] != null) Text('电话：${supplier['phone']}', style: value),
        ]),
        const SizedBox(height: 10),
        const Divider(color: Colors.black, height: 1, thickness: 1),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(children: const [
            Expanded(flex: 4, child: Text('品名/规格', style: label)),
            Expanded(flex: 1, child: Text('数量', style: label, textAlign: TextAlign.right)),
            Expanded(flex: 2, child: Text('进价', style: label, textAlign: TextAlign.right)),
            Expanded(flex: 2, child: Text('小计', style: label, textAlign: TextAlign.right)),
          ]),
        ),
        const Divider(color: Color(0xFFDDDDDD), height: 1),
        for (final it in items)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(children: [
              Expanded(
                flex: 4,
                child: Text(
                  '${it['productName']}${(it['specText'] ?? '') != '' && it['specText'] != null ? '\n${it['specText']}' : ''}'
                  '${(it['returnedQty'] ?? 0) > 0 ? '\n(已退${it['returnedQty']})' : ''}',
                  style: value,
                ),
              ),
              Expanded(flex: 1, child: Text('${it['quantity']}', style: value, textAlign: TextAlign.right)),
              Expanded(flex: 2, child: Text('¥${_money.format(it['unitPrice'])}', style: value, textAlign: TextAlign.right)),
              Expanded(flex: 2, child: Text('¥${_money.format(it['subtotal'])}', style: value, textAlign: TextAlign.right)),
            ]),
          ),
        const Divider(color: Colors.black, height: 1, thickness: 1),
        const SizedBox(height: 8),
        Align(
          alignment: Alignment.centerRight,
          child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text('应付：¥${_money.format(o['actualAmount'])}   已付：¥${_money.format(o['paidAmount'])}', style: value),
            if (unpaid > 0)
              Text('欠款：¥${_money.format(unpaid)}', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: Color(0xFFB25E00))),
          ]),
        ),
        const SizedBox(height: 12),
        Row(children: [
          const Expanded(child: Text('', style: label)),
          Text('打印时间：${_dt.format(DateTime.now())}', style: label),
        ]),
      ]),
    );
  }
}
