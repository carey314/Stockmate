import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/api.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';

/// 只读商品详情：给客人看货、自己查价用的页面。
/// 原来点商品卡直接进「编辑器」——把表单递给客人看，既不好看又容易误触改数据。
class ProductDetailScreen extends ConsumerStatefulWidget {
  final int productId;
  const ProductDetailScreen({super.key, required this.productId});

  @override
  ConsumerState<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends ConsumerState<ProductDetailScreen> {
  Product? _p;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final data = await Api.I.get('/products/${widget.productId}');
      if (mounted) setState(() => _p = Product.fromJson(data));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final p = _p;
    final types = ref.watch(typesProvider).valueOrNull;
    final fields = types?.where((tp) => tp.id == p?.productTypeId).firstOrNull?.fields ?? const <FieldDef>[];
    final productFields = fields.where((f) => f.scope == 'product').toList();

    return Scaffold(
      appBar: AppBar(title: Text(p?.name ?? '商品'), actions: [
        IconButton(
          icon: const Icon(Icons.edit_outlined),
          tooltip: '编辑',
          onPressed: () async {
            await context.push('/products/${widget.productId}/edit');
            _load();
          },
        ),
      ]),
      bottomNavigationBar: p == null
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
                child: FilledButton.icon(
                  onPressed: () => context.push('/orders/new'),
                  icon: const Icon(Icons.receipt_long_rounded, size: 18),
                  label: const Text('开单卖它'),
                ),
              ),
            ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : p == null
              ? const Center(child: Text('加载失败'))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(kPagePadding, 8, kPagePadding, 40),
                    children: [
                      SoftCard(
                        child: Row(children: [
                          ProductThumb(imageUrl: p.imageUrl, name: p.name, size: 76),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text(p.name, style: t.titleLarge),
                              const SizedBox(height: 4),
                              Text(
                                p.hasSpecs
                                    ? '¥${p.skus.map((s) => s.price).reduce((a, b) => a < b ? a : b)} ~ ¥${p.skus.map((s) => s.price).reduce((a, b) => a > b ? a : b)} / ${p.unit}'
                                    : '¥${p.defaultPrice} / ${p.unit}',
                                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.primary),
                              ),
                              Text('编码 ${p.code} · 总库存 ${fmtQty(p.totalStock)}', style: t.bodyMedium?.copyWith(fontSize: 11)),
                            ]),
                          ),
                        ]),
                      ),
                      // 商品字段（客人问"这是哪个厂的"就看这里）
                      if (productFields.any((f) => p.customFields[f.key] != null)) ...[
                        const SizedBox(height: 12),
                        SoftCard(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                          child: Wrap(spacing: 8, runSpacing: 8, children: [
                            for (final f in productFields)
                              if (p.customFields[f.key] != null && '${p.customFields[f.key]}'.isNotEmpty)
                                Chip(label: Text('${f.label}：${p.customFields[f.key]}${f.unit ?? ''}', style: const TextStyle(fontSize: 12))),
                          ]),
                        ),
                      ],
                      const SizedBox(height: 12),
                      Text('规格与库存', style: t.titleMedium),
                      const SizedBox(height: 8),
                      SoftCard(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                        child: Column(children: [
                          for (final s in p.skus)
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 7),
                              child: Row(children: [
                                ProductThumb(imageUrl: s.imageUrl ?? p.imageUrl, name: p.name, size: 38),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Text(s.displayName, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                                    if (s.barcode != null && s.barcode!.isNotEmpty)
                                      Text('条码 ${s.barcode}', style: const TextStyle(fontSize: 10, color: AppColors.onSurfaceVariant)),
                                  ]),
                                ),
                                Text('¥${s.price}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
                                const SizedBox(width: 12),
                                SizedBox(
                                  width: 64,
                                  child: Text(
                                    '库存 ${fmtQty(s.stock)}',
                                    textAlign: TextAlign.right,
                                    style: TextStyle(
                                      fontSize: 12,
                                      fontWeight: s.isLow ? FontWeight.w700 : FontWeight.w400,
                                      color: s.isLow ? AppColors.error : AppColors.onSurfaceVariant,
                                    ),
                                  ),
                                ),
                              ]),
                            ),
                        ]),
                      ),
                    ],
                  ),
                ),
    );
  }
}
