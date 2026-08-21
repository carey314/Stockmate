import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/api.dart';
import '../../core/models.dart';
import '../../core/theme.dart';

/// 库存流水：某个商品（或全店）的完整变动史。
///
/// 存在的理由：老板怀疑"账不对"的时候，这是唯一的排查工具——
/// 什么时候进的货、什么时候卖的、谁报的损、盘点调了多少，一条条摆出来。
/// 之前两端都没有这个视图（接口一直在），Web 先补了 SKU 抽屉，这里是 App 半边。
///
/// 带 productId 就只看这个商品（商品详情进来），不带就是全店流水（出入库页进来）。
class InventoryRecordsScreen extends StatefulWidget {
  final int? productId;
  final String? productName;
  const InventoryRecordsScreen({super.key, this.productId, this.productName});

  @override
  State<InventoryRecordsScreen> createState() => _InventoryRecordsScreenState();
}

class _InventoryRecordsScreenState extends State<InventoryRecordsScreen> {
  static final _dt = DateFormat('MM-dd HH:mm');
  final List<Map<String, dynamic>> _list = [];
  int _page = 1;
  int _total = 0;
  bool _loading = true;
  bool _more = false; // 正在加载更多
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool append = false}) async {
    setState(() {
      if (append) {
        _more = true;
      } else {
        _loading = true;
        _error = null;
        _page = 1;
      }
    });
    try {
      final q = StringBuffer('page=$_page&pageSize=20');
      if (widget.productId != null) q.write('&productId=${widget.productId}');
      final data = await Api.I.get('/inventory/records?$q');
      final rows = (data['list'] as List).cast<Map<String, dynamic>>();
      if (!mounted) return;
      setState(() {
        if (!append) _list.clear();
        _list.addAll(rows);
        _total = (data['pagination']?['total'] as num?)?.toInt() ?? _list.length;
      });
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() { _loading = false; _more = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.productName == null ? '库存流水' : '${widget.productName} · 流水'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    Text('加载失败：$_error', style: t.bodyMedium, textAlign: TextAlign.center),
                    TextButton(onPressed: _load, child: const Text('重试')),
                  ]),
                )
              : _list.isEmpty
                  ? Center(
                      child: Text('还没有库存变动\n开单、进货、盘点、报损都会在这里留痕',
                          textAlign: TextAlign.center, style: t.bodyMedium),
                    )
                  : RefreshIndicator(
                      onRefresh: () => _load(),
                      child: ListView.separated(
                        padding: const EdgeInsets.fromLTRB(kPagePadding, 8, kPagePadding, 32),
                        itemCount: _list.length + (_list.length < _total ? 1 : 0),
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (ctx, i) {
                          if (i == _list.length) {
                            // 尾部加载更多
                            return Center(
                              child: TextButton(
                                onPressed: _more ? null : () { _page += 1; _load(append: true); },
                                child: Text(_more ? '加载中…' : '加载更多（还有 ${_total - _list.length} 条）'),
                              ),
                            );
                          }
                          return _row(t, _list[i]);
                        },
                      ),
                    ),
    );
  }

  Widget _row(TextTheme t, Map<String, dynamic> r) {
    final inbound = r['type'] == 'inbound';
    final qty = (r['quantity'] as num?) ?? 0;
    final before = (r['beforeQuantity'] as num?) ?? 0;
    final after = (r['afterQuantity'] as num?) ?? 0;
    final spec = (r['sku']?['specText'] as String?) ?? '';
    final pname = (r['product']?['name'] as String?) ?? '';
    final who = (r['operator']?['realName'] as String?) ?? '';
    final when = DateTime.tryParse(r['createdAt'] ?? '');
    final orderId = r['relatedOrderId'] as int?;
    final poId = r['relatedPurchaseOrderId'] as int?;
    // reason 后端在各落库点写好了（销售出库/进货入库/盘点盘盈…），空值兜底到类型本身
    final reason = (r['reason'] as String?)?.trim();
    final label = (reason == null || reason.isEmpty) ? (inbound ? '入库' : '出库') : reason;
    final color = inbound ? AppColors.success : AppColors.warning;

    return SoftCard(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      // 带单号的流水点一下直接跳那张单——排查"这笔是谁开的"闭环在两步内
      onTap: orderId != null
          ? () => context.push('/orders/$orderId')
          : poId != null
              ? () => context.push('/purchase-orders/$poId')
              : null,
      child: Row(children: [
        Container(
          width: 34, height: 34,
          decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
          child: Icon(inbound ? Icons.south_west_rounded : Icons.north_east_rounded, size: 18, color: color),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(
              // 全店流水要带商品名认人；单商品流水只剩规格，短
              widget.productId == null ? '$pname${spec.isEmpty ? '' : ' · $spec'}' : (spec.isEmpty ? label : spec),
              maxLines: 1, overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 2),
            Text(
              [
                if (widget.productId == null || spec.isNotEmpty) label,
                if (who.isNotEmpty) who,
                if (when != null) _dt.format(when.toLocal()),
              ].join(' · '),
              maxLines: 1, overflow: TextOverflow.ellipsis,
              style: t.bodyMedium?.copyWith(fontSize: 11),
            ),
          ]),
        ),
        const SizedBox(width: 8),
        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text('${inbound ? '+' : '−'}${fmtQty(qty)}',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: color)),
          Text('${fmtQty(before)} → ${fmtQty(after)}',
              style: t.bodyMedium?.copyWith(fontSize: 11)),
        ]),
        if (orderId != null || poId != null) ...[
          const SizedBox(width: 4),
          const Icon(Icons.chevron_right_rounded, size: 18, color: AppColors.onSurfaceVariant),
        ],
      ]),
    );
  }
}
