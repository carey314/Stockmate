import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/api.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';

/// 商品/库存列表：品类筛选 chips + 库存状态
class ProductsScreen extends ConsumerStatefulWidget {
  const ProductsScreen({super.key});

  @override
  ConsumerState<ProductsScreen> createState() => _ProductsScreenState();
}

class _ProductsScreenState extends ConsumerState<ProductsScreen> {
  int? _typeFilter;
  bool _filterInited = false; // 首次进入默认落在主营品类
  String _query = ''; // 已提交给服务端的关键词（防抖后）
  final _searchCtl = TextEditingController();
  final _scrollCtl = ScrollController();
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    // 滚到底自动加载下一页
    _scrollCtl.addListener(() {
      if (_scrollCtl.position.pixels >= _scrollCtl.position.maxScrollExtent - 320) {
        ref.read(productListProvider(_currentQuery).notifier).loadMore();
      }
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtl.dispose();
    _scrollCtl.dispose();
    super.dispose();
  }

  ProductQuery get _currentQuery => ProductQuery(typeId: _typeFilter, keyword: _query);

  /// 搜索防抖：边打字边请求会打爆服务端，停 350ms 再查
  void _onSearchChanged(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      if (mounted && v.trim() != _query) setState(() => _query = v.trim());
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final types = ref.watch(typesProvider);
    // 主营品类：只做一门生意的人，进来就直接看到自己的货
    final mainTypeId = ref.watch(mainTypeIdProvider);
    if (!_filterInited && mainTypeId != null) {
      _typeFilter = mainTypeId;
      _filterInited = true;
    }
    final products = ref.watch(productListProvider(_currentQuery));

    return Scaffold(
      appBar: AppBar(title: const Text('商品库存')),
      floatingActionButton: FloatingActionButton(
        backgroundColor: AppColors.primary,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        onPressed: () async {
          await context.push('/products/new');
          ref.read(productListProvider(_currentQuery).notifier).refresh();
        },
        child: const Icon(Icons.add_rounded, color: Colors.white),
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.read(productListProvider(_currentQuery).notifier).refresh(),
        child: ListView(
          controller: _scrollCtl,
          padding: const EdgeInsets.fromLTRB(kPagePadding, 8, kPagePadding, 120),
          children: [
            Text('商品库存', style: t.headlineLarge),
            const SizedBox(height: 16),
            // 搜索：名称/编码/条码/规格
            TextField(
              controller: _searchCtl,
              onChanged: _onSearchChanged,
              textInputAction: TextInputAction.search,
              onSubmitted: (v) => setState(() => _query = v.trim()),
              decoration: InputDecoration(
                hintText: '搜商品名 / 条码 / 规格',
                prefixIcon: const Icon(Icons.search_rounded, color: AppColors.onSurfaceVariant),
                suffixIcon: _searchCtl.text.isEmpty
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
            // 品类筛选
            types.maybeWhen(
              // 只有一个品类时不显示筛选条（少一行噪音）
              data: (list) => list.length < 2
                  ? const SizedBox.shrink()
                  : SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(children: [
                        ChoiceChip(
                            label: const Text('全部'),
                            selected: _typeFilter == null,
                            onSelected: (_) => setState(() => _typeFilter = null)),
                        const SizedBox(width: 8),
                        for (final type in list) ...[
                          ChoiceChip(
                            label: Text('${type.name}${type.id == mainTypeId ? ' ★' : ''}'),
                            selected: _typeFilter == type.id,
                            onSelected: (_) => setState(() => _typeFilter = type.id),
                          ),
                          const SizedBox(width: 8),
                        ],
                      ]),
                    ),
              orElse: () => const SizedBox.shrink(),
            ),
            types.maybeWhen(data: (list) => SizedBox(height: list.length < 2 ? 0 : 16), orElse: () => const SizedBox(height: 16)),
            products.when(
              loading: () => const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator())),
              error: (e, _) => SoftCard(child: Text('加载失败：$e')),
              data: (page) {
                final list = page.items;
                if (list.isEmpty) {
                  return SoftCard(
                    child: Column(children: [
                      const Icon(Icons.inventory_2_outlined, size: 40, color: AppColors.outlineVariant),
                      const SizedBox(height: 10),
                      Text(_query.isEmpty ? '还没有商品' : '没有匹配「$_query」的商品', style: t.titleMedium),
                      const SizedBox(height: 4),
                      Text(_query.isEmpty ? '点右下角 + 添加，或用首页的 AI 口述记账' : '换个关键词，或清空搜索看全部',
                          style: t.bodyMedium, textAlign: TextAlign.center),
                    ]),
                  );
                }
                return Column(children: [
                  for (final p in list) _ProductCard(product: p),
                  // 分页尾巴：加载中 / 已到底 / 共多少个
                  Padding(
                    padding: const EdgeInsets.only(top: 4, bottom: 8),
                    child: Center(
                      child: page.loadingMore
                          ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                          : Text(
                              page.hasMore ? '已显示 ${list.length} / ${page.total} 个，继续下拉…' : '共 ${page.total} 个商品',
                              style: t.bodyMedium?.copyWith(fontSize: 12),
                            ),
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

/// 快捷调库存：每个规格一行 −/数字/＋，改完一键保存（走 /inventory/adjust 留流水）
Future<void> _quickAdjustStock(BuildContext context, WidgetRef ref, Product product) async {
  final ctls = {for (final s in product.skus) s.id: TextEditingController(text: fmtQty(s.stock))};
  final saved = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setModal) {
        double actualOf(int skuId, double fallback) => double.tryParse(ctls[skuId]!.text.trim()) ?? fallback;
        final changed = product.skus.where((s) => actualOf(s.id, s.stock) != s.stock).length;
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.only(left: 20, right: 20, top: 20, bottom: MediaQuery.of(ctx).viewInsets.bottom + 16),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('调整库存 · ${product.name}', style: Theme.of(ctx).textTheme.headlineMedium),
              const SizedBox(height: 4),
              Text('直接改成数出来的数量，保存后自动留调整流水', style: Theme.of(ctx).textTheme.bodyMedium?.copyWith(fontSize: 12)),
              const SizedBox(height: 12),
              ConstrainedBox(
                constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * 0.45),
                child: ListView(shrinkWrap: true, children: [
                  for (final s in product.skus)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(children: [
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(s.displayName, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                            Text('现在账面 ${fmtQty(s.stock)}', style: const TextStyle(fontSize: 11, color: AppColors.onSurfaceVariant)),
                          ]),
                        ),
                        IconButton(
                          icon: const Icon(Icons.remove_circle_outline, color: AppColors.onSurfaceVariant),
                          onPressed: () => setModal(() {
                            final v = actualOf(s.id, s.stock);
                            if (v > 0) ctls[s.id]!.text = fmtQty((v - 1).clamp(0, double.infinity));
                          }),
                        ),
                        SizedBox(
                          width: 64,
                          child: TextField(
                            controller: ctls[s.id],
                            keyboardType: const TextInputType.numberWithOptions(decimal: true),
                            textAlign: TextAlign.center,
                            onChanged: (_) => setModal(() {}),
                            decoration: InputDecoration(
                              isDense: true,
                              contentPadding: const EdgeInsets.symmetric(horizontal: 6, vertical: 10),
                              filled: true,
                              fillColor: actualOf(s.id, s.stock) != s.stock ? const Color(0xFFFFF4E5) : AppColors.surfaceContainer,
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                            ),
                          ),
                        ),
                        IconButton(
                          icon: const Icon(Icons.add_circle_outline, color: AppColors.primary),
                          onPressed: () => setModal(() => ctls[s.id]!.text = fmtQty(actualOf(s.id, s.stock) + 1)),
                        ),
                      ]),
                    ),
                ]),
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: changed == 0 ? null : () => Navigator.pop(ctx, true),
                  child: Text(changed == 0 ? '没有改动' : '保存（$changed 个规格有改动）'),
                ),
              ),
            ]),
          ),
        );
      },
    ),
  );
  if (saved != true) return;
  try {
    var count = 0;
    for (final s in product.skus) {
      final v = double.tryParse(ctls[s.id]!.text.trim());
      if (v == null || v == s.stock || v < 0) continue;
      await Api.I.post('/inventory/adjust', data: {'skuId': s.id, 'quantity': v, 'reason': '商品页快捷调整'});
      count++;
    }
    invalidateProducts(ref);
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('✓ 已调整 $count 个规格的库存')));
    }
  } catch (e) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
  }
}

class _ProductCard extends ConsumerWidget {
  final Product product;
  const _ProductCard({required this.product});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: SoftCard(
        padding: const EdgeInsets.all(16),
        onTap: () => context.push('/products/${product.id}'), // 看货页；编辑在详情页右上角
        child: Row(
          children: [
            // 统一用 ProductThumb：没图也占同样的位，列表左边缘才对得齐
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: ProductThumb(imageUrl: product.imageUrl, name: product.name, size: 52),
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Flexible(child: Text(product.name, style: t.titleMedium, overflow: TextOverflow.ellipsis)),
                    const SizedBox(width: 8),
                    if (product.productType != null) Chip(label: Text(product.productType!.name)),
                  ]),
                  const SizedBox(height: 4),
                  Text(
                    product.hasSpecs
                        ? '${product.skus.length}个规格 · ¥${product.skus.map((s) => s.price).reduce((a, b) => a < b ? a : b)}起'
                        : '¥${product.defaultPrice} / ${product.unit} · 编码 ${product.code}',
                    style: t.bodyMedium?.copyWith(fontSize: 12),
                  ),
                  // 药店的"999感冒灵"和"同仁堂感冒灵"全靠这行区分（字段设置里勾"列表显示"）
                  Consumer(builder: (context, ref, _) {
                    final types = ref.watch(typesProvider).valueOrNull;
                    final fields = types?.where((tp) => tp.id == product.productTypeId).firstOrNull?.fields ?? const [];
                    final parts = [
                      for (final f in fields)
                        if (f.showInList && (product.customFields[f.key]?.toString().isNotEmpty ?? false))
                          '${f.label}:${product.customFields[f.key]}'
                    ];
                    if (parts.isEmpty) return const SizedBox.shrink();
                    return Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(parts.join(' · '), style: const TextStyle(fontSize: 11, color: AppColors.primary)),
                    );
                  }),
                  if (product.hasSpecs)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Wrap(
                        spacing: 6,
                        runSpacing: 4,
                        children: [
                          for (final s in product.skus.take(3))
                            Chip(label: Text('${s.displayName}  库存${fmtQty(s.stock)}')),
                          if (product.skus.length > 3) Chip(label: Text('还有${product.skus.length - 3}个规格')),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            // 点库存数字 → 快捷调库存（不用进编辑页）
            GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () => _quickAdjustStock(context, ref, product),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: product.isLow ? const Color(0xFFFDECEC) : AppColors.surfaceContainer,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Row(mainAxisSize: MainAxisSize.min, children: [
                      Text(
                        fmtQty(product.totalStock),
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                          color: product.isLow ? AppColors.error : AppColors.onSurface,
                        ),
                      ),
                      const SizedBox(width: 3),
                      const Icon(Icons.edit_rounded, size: 13, color: AppColors.onSurfaceVariant),
                    ]),
                    Text(product.isLow ? '有规格缺货' : '总库存', style: TextStyle(fontSize: 10, color: product.isLow ? AppColors.error : AppColors.onSurfaceVariant)),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
