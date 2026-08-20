import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
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

/// 销售单详情：票据样式展示 + 一键生成图片分享（微信/存相册/打印的公共底座）
class OrderDetailScreen extends ConsumerStatefulWidget {
  final int orderId;
  const OrderDetailScreen({super.key, required this.orderId});

  @override
  ConsumerState<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends ConsumerState<OrderDetailScreen> {
  final _receiptKey = GlobalKey(); // 截取票据区域用
  Map<String, dynamic>? _order;
  bool _sharing = false;

  @override
  void initState() {
    super.initState();
    _load();
  }


  /// 作废整单：库存退回、收过的钱生成退款流水，不可恢复。
  /// 放在右上角菜单而不是底部动作区——它和「收款」「再来一单」不是一个量级的操作，
  /// 并排摆着迟早被误点（跟删除账号不能挨着退出登录是同一个道理）。
  Future<void> _cancelOrder() async {
    final o = _order;
    if (o == null) return;
    final paid = ((o['paidAmount'] ?? 0) as num).toDouble();
    final ok = await showDialog<bool>(
      context: context,
      builder: (dctx) => AlertDialog(
        title: const Text('作废这张单？'),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('单号 ${o['orderNo']}'),
          const SizedBox(height: 10),
          const Text('· 卖出去的货会退回库存', style: TextStyle(fontSize: 13)),
          if (paid > 0.001)
            Text('· 已收的 ¥${_money.format(paid)} 会记一笔退款流水（钱要真退给客户）',
                style: const TextStyle(fontSize: 13, color: AppColors.error)),
          const SizedBox(height: 8),
          const Text('作废后不能恢复。', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dctx, false), child: const Text('再想想')),
          TextButton(
            onPressed: () => Navigator.pop(dctx, true),
            child: const Text('确认作废', style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.I.put('/orders/${widget.orderId}/cancel');
      ref.invalidate(ordersProvider);
      invalidateProducts(ref);
      ref.invalidate(overviewProvider);
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text('✓ 已作废，库存已退回${paid > 0.001 ? '，应退客户 ¥${_money.format(paid)}' : ''}')));
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('作废失败：$e')));
    }
  }

  Future<void> _load() async {
    try {
      final data = await Api.I.get('/orders/${widget.orderId}');
      if (mounted) setState(() => _order = Map<String, dynamic>.from(data));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  bool _hasReturnable(Map<String, dynamic> o) =>
      (o['items'] as List? ?? []).any((it) => (it['quantity'] ?? 0) - (it['returnedQty'] ?? 0) > 0);

  double get _unpaid {
    final o = _order;
    if (o == null) return 0;
    return ((o['actualAmount'] ?? 0) - (o['paidAmount'] ?? 0)).toDouble();
  }

  /// 收欠款：客人把赊的钱还了，得能记上。
  /// 后端 /orders/:id/receive-payment 早就有，之前 App 里没有任何入口——
  /// 结果是「能记赊账、不能记还钱」，比纸本子还不如（本子还能划一道）。
  Future<void> _receivePayment() async {
    final unpaid = _unpaid;
    final amount = TextEditingController(text: unpaid.toStringAsFixed(unpaid % 1 == 0 ? 0 : 2));
    String? account;
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModal) => Padding(
          padding: EdgeInsets.fromLTRB(24, 24, 24, MediaQuery.of(ctx).viewInsets.bottom + 32),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('收欠款', style: Theme.of(ctx).textTheme.headlineMedium),
            const SizedBox(height: 4),
            Text('${_order!['customer']?['name'] ?? '客户'} 还欠 ¥${_money.format(unpaid)}，收多少记多少，可以分次收',
                style: Theme.of(ctx).textTheme.bodyMedium?.copyWith(fontSize: 12)),
            const SizedBox(height: 16),
            TextField(
              controller: amount,
              autofocus: true,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: '收款金额 ¥'),
              onChanged: (_) => setModal(() {}),
            ),
            const SizedBox(height: 12),
            Wrap(spacing: 8, children: [
              for (final a in ['现金', '微信', '支付宝', '银行卡'])
                ChoiceChip(label: Text(a), selected: account == a, onSelected: (_) => setModal(() => account = a)),
            ]),
            const SizedBox(height: 16),
            Builder(builder: (_) {
              final v = double.tryParse(amount.text) ?? 0;
              final left = unpaid - v;
              return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                if (v > 0 && left > 0.001)
                  Text('收完还欠 ¥${_money.format(left)}', style: const TextStyle(fontSize: 12, color: AppColors.warning)),
                if (v > 0 && left <= 0.001)
                  const Text('收完这单就结清了', style: TextStyle(fontSize: 12, color: AppColors.success)),
                const SizedBox(height: 10),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: v > 0 && v <= unpaid + 0.001 ? () => Navigator.pop(ctx, true) : null,
                    child: Text(v <= 0
                        ? '填写收款金额'
                        : (v > unpaid + 0.001 ? '不能超过欠款 ¥${_money.format(unpaid)}' : '确认收款 ¥${_money.format(v)}')),
                  ),
                ),
              ]);
            }),
          ]),
        ),
      ),
    );
    if (ok != true) return;
    final v = double.tryParse(amount.text);
    if (v == null || v <= 0) return;
    try {
      final r = await Api.I.post('/orders/${widget.orderId}/receive-payment',
          data: {'amount': v, if (account != null) 'settlementAccount': account});
      ref.invalidate(ordersProvider);
      ref.invalidate(overviewProvider);
      await _load();
      if (mounted) {
        final left = (r['unpaidAmount'] ?? 0).toDouble();
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(left > 0.001 ? '✓ 已收 ¥${_money.format(v)}，还欠 ¥${_money.format(left)}' : '✓ 已收 ¥${_money.format(v)}，这单结清了')));
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  /// 退货：选商品和数量（≤可退量）→ 自动回库存/冲应收/退多收的钱
  Future<void> _returnItems() async {
    final o = _order!;
    final items = List<Map<String, dynamic>>.from(o['items'] ?? []);
    final qtys = <int, int>{}; // itemId → 退货数量

    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModal) {
          double returnValue = 0;
          for (final it in items) {
            final q = qtys[it['id']] ?? 0;
            returnValue += q * (it['unitPrice'] ?? 0);
          }
          return SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('退货', style: Theme.of(ctx).textTheme.headlineMedium),
                  const SizedBox(height: 4),
                  Text('自动回库存、冲减应收，多收的钱按原结算方式退', style: Theme.of(ctx).textTheme.bodyMedium),
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
                              Text('¥${it['unitPrice']} · 可退 $returnable 件${(it['returnedQty'] ?? 0) > 0 ? '（已退${it['returnedQty']}）' : ''}',
                                  style: const TextStyle(fontSize: 12, color: AppColors.onSurfaceVariant)),
                            ]),
                          ),
                          IconButton(
                            icon: const Icon(Icons.remove_circle_outline, size: 22),
                            onPressed: q > 0 ? () => setModal(() => qtys[it['id']] = q - 1) : null,
                          ),
                          Text('$q', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                          IconButton(
                            icon: const Icon(Icons.add_circle_outline, size: 22),
                            onPressed: q < returnable ? () => setModal(() => qtys[it['id']] = q + 1) : null,
                          ),
                        ]),
                      );
                    }),
                  const SizedBox(height: 10),
                  FilledButton(
                    onPressed: returnValue > 0 ? () => Navigator.pop(ctx, true) : null,
                    child: Text(returnValue > 0 ? '确认退货 ¥${returnValue.toStringAsFixed(returnValue % 1 == 0 ? 0 : 2)}' : '选择退货数量'),
                  ),
                ],
              ),
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
      final r = await Api.I.post('/orders/${widget.orderId}/return', data: {'items': payload});
      ref.invalidate(ordersProvider);
      invalidateProducts(ref);
      ref.invalidate(overviewProvider);
      await _load(); // 刷新单据（金额/已退标记）
      if (mounted) {
        // 换货桥：M 换 L 十有八九是退完马上开新单，把下一步递到手边
        final custId = _order?['customerId'];
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text('✓ 已退货，冲减 ¥${r['returnValue']}${(r['refundCash'] ?? 0) > 0 ? '，退款 ¥${r['refundCash']}' : ''}'),
          action: custId == null
              ? null
              : SnackBarAction(label: '换货？开新单', onPressed: () => context.push('/orders/new?customer=$custId')),
          duration: const Duration(seconds: 5),
        ));
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  /// 票据区域 → 高清图片 → 系统分享（微信/相册/AirPrint都在分享面板里）
  Future<void> _shareAsImage() async {
    if (_sharing) return;
    setState(() => _sharing = true);
    try {
      final boundary = _receiptKey.currentContext!.findRenderObject() as RenderRepaintBoundary;
      final image = await boundary.toImage(pixelRatio: 3.0);
      final bytes = (await image.toByteData(format: ui.ImageByteFormat.png))!.buffer.asUint8List();
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/单据_${_order!['orderNo']}.png');
      await file.writeAsBytes(bytes);
      if (mounted) await shareFiles(context, [XFile(file.path)], text: '销售单 ${_order!['orderNo']}');
      // 标记打印/分享时间
      await Api.I.put('/orders/${widget.orderId}/printed');
      ref.invalidate(ordersProvider);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('分享失败：$e')));
    } finally {
      if (mounted) setState(() => _sharing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final o = _order;
    return Scaffold(
      appBar: AppBar(
        title: Text(o?['orderNo'] ?? '单据详情'),
        actions: [
          if (o != null && o['status'] == 'completed')
            PopupMenuButton<String>(
              tooltip: '更多',
              onSelected: (v) { if (v == 'cancel') _cancelOrder(); },
              itemBuilder: (_) => const [
                PopupMenuItem(
                  value: 'cancel',
                  child: Text('作废这张单', style: TextStyle(color: AppColors.error)),
                ),
              ],
            ),
        ],
      ),
      bottomNavigationBar: o == null
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  // 还有欠款时，收款就是这张单最该干的事，单独占一整行做主按钮
                  if (o['status'] == 'completed' && _unpaid > 0.001) ...[
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: _receivePayment,
                        icon: const Icon(Icons.account_balance_wallet_rounded, size: 20),
                        label: Text('收款 ¥${_money.format(_unpaid)}'),
                      ),
                    ),
                    const SizedBox(height: 8),
                  ],
                  // 次要动作等宽一行（图标在上文字在下，中文标签永远不会被挤到换行），
                  // 主动作「分享单据图片」独占整行——发给客户是这页最高频的事
                  Row(children: [
                    if (o['status'] == 'completed' && _hasReturnable(o)) ...[
                      _MiniAction(icon: Icons.u_turn_left_rounded, label: '退货', onTap: _returnItems),
                      const SizedBox(width: 10),
                    ],
                    // 再来一单：熟客复购是常态，整单复制改数量
                    _MiniAction(
                      icon: Icons.repeat_rounded,
                      label: '再来一单',
                      onTap: () => context.push('/orders/new?from=${widget.orderId}'),
                    ),
                    const SizedBox(width: 10),
                    _MiniAction(
                      icon: Icons.print_outlined,
                      label: '打印小票',
                      onTap: () async {
                        await PrinterService.I.printReceipt(context, _receiptKey);
                        Api.I.put('/orders/${widget.orderId}/printed').ignore();
                      },
                    ),
                  ]),
                  const SizedBox(height: 10),
                  SizedBox(
                    width: double.infinity,
                    child: _unpaid > 0.001
                        ? OutlinedButton.icon(
                            onPressed: _sharing ? null : _shareAsImage,
                            icon: _sharing
                                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                                : const Icon(Icons.ios_share_rounded, size: 20),
                            label: Text(_sharing ? '生成中…' : '分享单据图片'),
                          )
                        : FilledButton.icon(
                            onPressed: _sharing ? null : _shareAsImage,
                            icon: _sharing
                                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                                : const Icon(Icons.ios_share_rounded, size: 20),
                            label: Text(_sharing ? '生成中…' : '分享单据图片'),
                          ),
                  ),
                ]),
              ),
            ),
      body: o == null
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(kPagePadding, 12, kPagePadding, 24),
              // RepaintBoundary 内是纯白票据样式（分享出去干净专业）
              child: RepaintBoundary(key: _receiptKey, child: _Receipt(order: o)),
            ),
    );
  }
}

/// 票据（对齐传统销货单版式：抬头/双方信息/明细表/金额区/落款）
class _Receipt extends ConsumerWidget {
  final Map<String, dynamic> order;
  const _Receipt({required this.order});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final o = order;
    final items = List<Map<String, dynamic>>.from(o['items'] ?? []);
    final customer = o['customer'] ?? {};
    final unpaid = (o['unpaidAmount'] ?? 0).toDouble();
    final shopName = ref.watch(profileProvider).valueOrNull?['shopName'] ?? '销售单';

    const label = TextStyle(fontSize: 11, color: Color(0xFF888888));
    const value = TextStyle(fontSize: 12, color: Color(0xFF222222));

    return Container(
      color: Colors.white,
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 抬头
          Center(
            child: Column(children: [
              Text(shopName, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: Colors.black)),
              const SizedBox(height: 2),
              const Text('销 售 单', style: TextStyle(fontSize: 13, letterSpacing: 6, color: Color(0xFF555555))),
            ]),
          ),
          const SizedBox(height: 14),
          // 单头信息
          Row(children: [
            Expanded(child: Text('单号：${o['orderNo']}', style: value)),
            Text('日期：${_dt.format(DateTime.parse(o['createdAt']).toLocal())}', style: value),
          ]),
          const SizedBox(height: 4),
          Row(children: [
            Expanded(child: Text('客户：${customer['name'] ?? '-'}', style: value)),
            if ((customer['phone'] ?? '').toString().isNotEmpty) Text('电话：${customer['phone']}', style: value),
          ]),
          if ((customer['address'] ?? '').toString().isNotEmpty)
            Padding(padding: const EdgeInsets.only(top: 4), child: Text('地址：${customer['address']}', style: value)),
          const SizedBox(height: 10),
          const Divider(color: Colors.black, height: 1, thickness: 1),
          // 明细表头
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(children: const [
              Expanded(flex: 4, child: Text('品名/规格', style: label)),
              Expanded(flex: 1, child: Text('数量', style: label, textAlign: TextAlign.right)),
              Expanded(flex: 2, child: Text('单价', style: label, textAlign: TextAlign.right)),
              Expanded(flex: 2, child: Text('小计', style: label, textAlign: TextAlign.right)),
            ]),
          ),
          const Divider(color: Color(0xFFDDDDDD), height: 1),
          // 明细行
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
          // 金额区
          _amountRow('合计', o['totalAmount'], bold: false),
          if ((o['discountAmount'] ?? 0) > 0)
            _amountRow('折扣${o['discountRate'] != null ? '（${o['discountRate']}折）' : ''}', -o['discountAmount']),
          _amountRow('应收', o['actualAmount'], bold: true),
          _amountRow('已收', o['paidAmount']),
          if (unpaid > 0) _amountRow('欠款', unpaid, color: const Color(0xFFB25E00), bold: true),
          if ((o['settlementAccount'] ?? '') != '' && o['settlementAccount'] != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Align(alignment: Alignment.centerRight, child: Text('结算方式：${o['settlementAccount']}', style: value)),
            ),
          if ((o['notes'] ?? '') != '' && o['notes'] != null)
            Padding(padding: const EdgeInsets.only(top: 8), child: Text('备注：${o['notes']}', style: value)),
          const SizedBox(height: 14),
          // 落款
          Row(children: [
            Expanded(child: Text('制单：${o['operator']?['realName'] ?? '-'}', style: label)),
            Text('打印时间：${_dt.format(DateTime.now())}', style: label),
          ]),
          const SizedBox(height: 6),
          const Center(child: Text('—— 感谢惠顾 ——', style: TextStyle(fontSize: 11, color: Color(0xFFAAAAAA)))),
        ],
      ),
    );
  }

  Widget _amountRow(String label, dynamic amount, {bool bold = false, Color? color}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          Text('$label：', style: TextStyle(fontSize: 12, color: color ?? const Color(0xFF555555))),
          SizedBox(
            width: 90,
            child: Text(
              '¥${_money.format((amount ?? 0).toDouble())}',
              textAlign: TextAlign.right,
              style: TextStyle(
                fontSize: bold ? 15 : 12,
                fontWeight: bold ? FontWeight.w800 : FontWeight.w400,
                color: color ?? Colors.black,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 底部次要动作按钮：等宽、图标在上文字在下。
/// 横排图标+文字在中文四字标签下会被挤换行（"退/货"），竖排永远不会。
class _MiniAction extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  const _MiniAction({required this.icon, required this.label, this.onTap});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: OutlinedButton(
        onPressed: onTap,
        // 主题给按钮设了 minimumSize 宽=∞，Row 里必须覆盖回有限值
        style: OutlinedButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
          minimumSize: const Size(0, 56),
        ),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 19),
          const SizedBox(height: 3),
          Text(label, style: const TextStyle(fontSize: 11.5, height: 1.1), maxLines: 1),
        ]),
      ),
    );
  }
}
