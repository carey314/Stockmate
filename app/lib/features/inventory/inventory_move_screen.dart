import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';

/// 独立出入库：报损/过期/自用/纠错这些「不是买卖」的库存变动。
/// 语义是「减 N / 加 N」（相对量），不是"设成 N"——盘点才是设数。
/// 原来全 App 唯一的手动出库藏在扫码页里，没有条码的货连损都没法报。
class InventoryMoveScreen extends ConsumerStatefulWidget {
  const InventoryMoveScreen({super.key});

  @override
  ConsumerState<InventoryMoveScreen> createState() => _InventoryMoveScreenState();
}

class _MoveLine {
  final Product product;
  final Sku sku;
  final TextEditingController qty = TextEditingController(text: '1');
  _MoveLine(this.product, this.sku);
}

const _outReasons = ['报损', '过期', '损坏', '自用', '送人', '盘亏纠错'];
const _inReasons = ['盘盈纠错', '客户退回', '自用退回', '其他入库'];

class _InventoryMoveScreenState extends ConsumerState<InventoryMoveScreen> {
  String _type = 'outbound'; // 高频是出库（报损/自用）
  String? _reason;
  final List<_MoveLine> _lines = [];
  bool _saving = false;

  List<String> get _reasons => _type == 'outbound' ? _outReasons : _inReasons;

  Future<void> _addProduct() async {
    final all = await ref.read(productsProvider(null).future);
    final mainTypeId = ref.read(mainTypeIdProvider);
    if (!mounted) return;
    final picked = await showModalBottomSheet<(Product, Sku)>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) {
        String q = '';
        return StatefulBuilder(builder: (ctx, setModal) {
          var products = all.where((p) => p.matches(q)).toList();
          // 主营品类排前面
          products.sort((a, b) {
            final am = a.productTypeId == mainTypeId ? 0 : 1;
            final bm = b.productTypeId == mainTypeId ? 0 : 1;
            return am.compareTo(bm);
          });
          return SafeArea(
            child: SizedBox(
              height: MediaQuery.of(ctx).size.height * 0.75,
              child: Column(children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
                  child: TextField(
                    onChanged: (v) => setModal(() => q = v),
                    decoration: InputDecoration(
                      hintText: '搜商品名 / 条码 / 规格',
                      prefixIcon: const Icon(Icons.search_rounded, color: AppColors.onSurfaceVariant),
                      isDense: true,
                      filled: true,
                      fillColor: AppColors.surfaceContainer,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
                    ),
                  ),
                ),
                Expanded(
                  child: ListView(padding: const EdgeInsets.fromLTRB(20, 0, 20, 20), children: [
                    for (final p in products)
                      for (final s in p.skus)
                        ListTile(
                          leading: ProductThumb(imageUrl: s.imageUrl ?? p.imageUrl, name: p.name, size: 40),
                          title: Text(p.name + (s.specText.isNotEmpty ? ' ${s.specText}' : '')),
                          subtitle: Text('库存 ${fmtQty(s.stock)}'),
                          onTap: () => Navigator.pop(ctx, (p, s)),
                        ),
                  ]),
                ),
              ]),
            ),
          );
        });
      },
    );
    if (picked == null) return;
    if (_lines.any((l) => l.sku.id == picked.$2.id)) return;
    setState(() => _lines.add(_MoveLine(picked.$1, picked.$2)));
  }

  Future<void> _submit() async {
    if (_lines.isEmpty) return _toast('先添加商品');
    if (_reason == null) return _toast('选一个原因（记账要说得清为什么动库存）');
    setState(() => _saving = true);
    var okCount = 0;
    double lossTotal = 0;
    final failed = <String>[];
    // 逐条提交：一条失败不该拖垮别的（报损常常一次好几样）
    for (final l in _lines) {
      final q = double.tryParse(l.qty.text.trim());
      if (q == null || q <= 0) {
        failed.add('${l.product.name}（数量没填对）');
        continue;
      }
      try {
        final r = await Api.I.post('/inventory/$_type', data: {'skuId': l.sku.id, 'quantity': q, 'reason': _reason});
        okCount++;
        lossTotal += ((r['lossBooked'] ?? 0) as num).toDouble();
      } catch (e) {
        failed.add('${l.product.name}（$e）');
      }
    }
    invalidateProducts(ref);
    ref.invalidate(overviewProvider);
    if (!mounted) return;
    setState(() => _saving = false);
    if (failed.isEmpty) {
      _toast('✓ ${_type == 'outbound' ? '出库' : '入库'} $okCount 项完成${lossTotal > 0 ? '，已按成本记损耗 ¥${lossTotal.toStringAsFixed(2)}' : ''}');
      setState(() => _lines.clear());
    } else {
      _toast('完成 $okCount 项，失败：${failed.join('；')}');
      setState(() => _lines.removeWhere((l) => !failed.any((f) => f.startsWith(l.product.name))));
    }
  }

  void _toast(String m) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('出入库')),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
          child: FilledButton(
            onPressed: _saving ? null : _submit,
            child: Text(_saving ? '提交中…' : (_type == 'outbound' ? '确认出库（${_lines.length} 项）' : '确认入库（${_lines.length} 项）')),
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(kPagePadding, 8, kPagePadding, 40),
        children: [
          Row(children: [
            Expanded(
              child: ChoiceChip(
                label: const Center(child: Text('出库 −')),
                selected: _type == 'outbound',
                onSelected: (_) => setState(() {
                  _type = 'outbound';
                  _reason = null;
                }),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: ChoiceChip(
                label: const Center(child: Text('入库 +')),
                selected: _type == 'inbound',
                onSelected: (_) => setState(() {
                  _type = 'inbound';
                  _reason = null;
                }),
              ),
            ),
          ]),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(color: const Color(0xFFFFF4E5), borderRadius: BorderRadius.circular(12)),
            child: const Text(
              '这里只改库存不记钱。卖货用「开单」、进货用「进货单」；报损/过期出库会按成本自动记一笔「库存损耗」开销，利润才是真的。',
              style: TextStyle(fontSize: 12, height: 1.5, color: AppColors.warning),
            ),
          ),
          const SizedBox(height: 14),
          Text('为什么动库存', style: t.titleMedium),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final r in _reasons)
              ChoiceChip(label: Text(r), selected: _reason == r, onSelected: (_) => setState(() => _reason = r)),
          ]),
          const SizedBox(height: 14),
          Row(children: [
            Expanded(child: Text('商品（${_lines.length}）', style: t.titleMedium)),
            TextButton.icon(onPressed: _addProduct, icon: const Icon(Icons.add, size: 18), label: const Text('添加')),
          ]),
          if (_lines.isEmpty)
            SoftCard(child: Text('点右上角「添加」选商品；数量是「动多少」，不是"改成多少"', style: t.bodyMedium?.copyWith(fontSize: 12))),
          for (final (i, l) in _lines.indexed)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: SoftCard(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                child: Row(children: [
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(l.product.name + (l.sku.specText.isNotEmpty ? ' ${l.sku.specText}' : ''),
                          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                      Text('现库存 ${fmtQty(l.sku.stock)}', style: const TextStyle(fontSize: 11, color: AppColors.onSurfaceVariant)),
                    ]),
                  ),
                  Text(_type == 'outbound' ? '−' : '＋',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: _type == 'outbound' ? AppColors.error : AppColors.success)),
                  SizedBox(
                    width: 72,
                    child: TextField(
                      controller: l.qty,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      textAlign: TextAlign.center,
                      decoration: InputDecoration(
                        isDense: true,
                        contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
                        filled: true,
                        fillColor: AppColors.surfaceContainer,
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                      ),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close_rounded, size: 18, color: AppColors.onSurfaceVariant),
                    onPressed: () => setState(() => _lines.removeAt(i)),
                  ),
                ]),
              ),
            ),
        ],
      ),
    );
  }
}
