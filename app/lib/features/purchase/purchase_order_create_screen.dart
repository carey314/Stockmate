import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/api.dart';
import '../../core/pick_image.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';

/// 新建进货单：选供应商(可快建) → 加商品(选规格,填进价) → 折扣/已付/结算 → 提交即入库
class PurchaseOrderCreateScreen extends ConsumerStatefulWidget {
  const PurchaseOrderCreateScreen({super.key});

  @override
  ConsumerState<PurchaseOrderCreateScreen> createState() => _PurchaseOrderCreateScreenState();
}

class _PoItem {
  final Product product;
  final Sku sku;
  double quantity;
  double unitPrice; // 进价
  _PoItem({required this.product, required this.sku, required this.unitPrice, double? qty}) : quantity = qty ?? 1;
}

const _accounts = ['现金', '微信', '支付宝', '银行卡', '挂账'];

/// 快建商品哨兵
final _kPoQuickCreate = Product(id: -1, code: '', name: '', productTypeId: -1);

class _PurchaseOrderCreateScreenState extends ConsumerState<PurchaseOrderCreateScreen> {
  Supplier? _supplier;
  final List<_PoItem> _items = [];
  final _paid = TextEditingController();
  String? _settlement;
  bool _saving = false;
  bool _ocrRunning = false;
  static const _draftKey = 'po_draft_v1';
  static const _ocrChannel = MethodChannel('stockmate/ocr');

  @override
  void initState() {
    super.initState();
    _restoreDraft();
  }

  /// 草稿：进货单往往边收货边填，中途来个客人切走，回来单子还在。
  /// 只存本机（skuId+数量+进价+供应商），提交成功即清。
  Future<void> _saveDraft() async {
    final sp = await SharedPreferences.getInstance();
    if (_items.isEmpty) {
      await sp.remove(_draftKey);
      return;
    }
    await sp.setString(
      _draftKey,
      jsonEncode({
        'supplierId': _supplier?.id,
        'items': [
          for (final i in _items) {'skuId': i.sku.id, 'qty': i.quantity, 'price': i.unitPrice}
        ],
      }),
    );
  }

  Future<void> _restoreDraft() async {
    final sp = await SharedPreferences.getInstance();
    final raw = sp.getString(_draftKey);
    if (raw == null) return;
    try {
      final d = jsonDecode(raw) as Map<String, dynamic>;
      final all = await ref.read(productsProvider(null).future);
      final restored = <_PoItem>[];
      for (final it in (d['items'] as List)) {
        for (final p in all) {
          final sku = p.skus.where((k) => k.id == it['skuId']).firstOrNull;
          if (sku != null) {
            restored.add(_PoItem(product: p, sku: sku, unitPrice: (it['price'] as num).toDouble(), qty: (it['qty'] as num).toDouble()));
            break;
          }
        }
      }
      if (restored.isEmpty || !mounted) return;
      Supplier? sup;
      if (d['supplierId'] != null) {
        final sups = await ref.read(suppliersProvider.future);
        sup = sups.where((x) => x.id == d['supplierId']).firstOrNull;
      }
      if (!mounted) return;
      setState(() {
        _items.addAll(restored);
        _supplier ??= sup;
      });
      _toast('上次没提交的进货单已恢复（${restored.length} 项）');
    } catch (_) {
      await sp.remove(_draftKey);
    }
  }

  /// M32: 拍供应商送货单 → 苹果原生 OCR → AI(purchaseBill 模式)解析 → 直接铺成进货单
  /// 手抄一张 20 行的送货单要 15 分钟还容易抄错行，拍一张 10 秒。
  Future<void> _importFromPhoto() async {
    if (_ocrRunning) return;
    final picked = await pickImageWithChoice(context, cameraLabel: '拍送货单', galleryLabel: '从相册选');
    if (picked == null) return;
    setState(() => _ocrRunning = true);
    try {
      final text = await _ocrChannel.invokeMethod<String>('recognizeText', {'path': picked.path});
      if (text == null || text.trim().length < 4) {
        _toast('没识别出文字，换张更清晰的照片');
        return;
      }
      final data = await Api.I.post('/ai/parse-entry', data: {'text': text.trim(), 'mode': 'purchaseBill'});
      final result = ParseResult.fromJson(data);
      final all = await ref.read(productsProvider(null).future);
      var added = 0;
      final unmatched = <String>[];
      for (final it in result.purchases) {
        Product? prod;
        if (it.matchedProductId != null) {
          prod = all.where((p) => p.id == it.matchedProductId).firstOrNull;
        }
        if (prod == null) {
          unmatched.add(it.name);
          continue;
        }
        final sku = prod.defaultSku;
        if (sku == null) continue;
        final price = it.unitCost ?? ((it.totalCost != null && it.quantity > 0) ? it.totalCost! / it.quantity : (sku.costPrice ?? 0));
        final existing = _items.where((x) => x.sku.id == sku.id).firstOrNull;
        if (existing != null) {
          existing.quantity += it.quantity;
          existing.unitPrice = double.parse(price.toStringAsFixed(2));
        } else {
          _items.add(_PoItem(product: prod, sku: sku, unitPrice: double.parse(price.toStringAsFixed(2)), qty: it.quantity));
        }
        added++;
      }
      // 识别出的供应商名：档案里有就自动选上
      if (_supplier == null && result.supplierName != null && result.supplierName!.isNotEmpty) {
        final sups = await ref.read(suppliersProvider.future);
        final hit = sups.where((x) => x.name.contains(result.supplierName!) || result.supplierName!.contains(x.name)).firstOrNull;
        if (hit != null) _supplier = hit;
      }
      if (!mounted) return;
      setState(() {});
      _saveDraft();
      _toast('✓ 识别进 $added 项${unmatched.isEmpty ? '' : '；没匹配上：${unmatched.take(3).join("、")}${unmatched.length > 3 ? ' 等' : ''}（先建档再拍）'}');
    } on PlatformException catch (e) {
      _toast('识别失败：${e.message}');
    } catch (e) {
      _toast('$e');
    } finally {
      if (mounted) setState(() => _ocrRunning = false);
    }
  }

  double get _total => _items.fold(0.0, (s, i) => s + i.quantity * i.unitPrice);

  void _toast(String m) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  Future<void> _pickSupplier() async {
    final suppliers = await ref.read(suppliersProvider.future);
    if (!mounted) return;
    final picked = await showModalBottomSheet<dynamic>(
      context: context,
      builder: (ctx) => SafeArea(
        child: ListView(padding: const EdgeInsets.all(20), shrinkWrap: true, children: [
          Text('选择供应商', style: Theme.of(ctx).textTheme.headlineMedium),
          const SizedBox(height: 12),
          ListTile(
            leading: const Icon(Icons.add_circle_outline, color: AppColors.primary),
            title: const Text('新建供应商', style: TextStyle(color: AppColors.primary, fontWeight: FontWeight.w600)),
            onTap: () => Navigator.pop(ctx, 'new'),
          ),
          const Divider(height: 1),
          for (final s in suppliers)
            ListTile(title: Text(s.name), subtitle: s.phone == null ? null : Text(s.phone!), onTap: () => Navigator.pop(ctx, s)),
        ]),
      ),
    );
    if (picked == 'new') {
      final created = await _createSupplier();
      if (created != null) setState(() => _supplier = created);
    } else if (picked is Supplier) {
      setState(() => _supplier = picked);
    }
  }

  Future<Supplier?> _createSupplier() async {
    final name = TextEditingController();
    final phone = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (dctx) => AlertDialog(
        title: const Text('新建供应商'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: name, autofocus: true, decoration: const InputDecoration(hintText: '供应商名称')),
          const SizedBox(height: 10),
          TextField(controller: phone, decoration: const InputDecoration(hintText: '电话（选填）')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dctx, false), child: const Text('取消')),
          TextButton(onPressed: () => Navigator.pop(dctx, true), child: const Text('保存')),
        ],
      ),
    );
    if (ok != true || name.text.trim().isEmpty) return null;
    try {
      final data = await Api.I.post('/suppliers', data: {
        'name': name.text.trim(),
        if (phone.text.trim().isNotEmpty) 'phone': phone.text.trim(),
      });
      ref.invalidate(suppliersProvider);
      return Supplier.fromJson(data);
    } catch (e) {
      _toast('$e');
      return null;
    }
  }

  Future<void> _addProduct() async {
    final all = await ref.read(productsProvider(null).future);
    final types = await ref.read(typesProvider.future);
    final mainTypeId = ref.read(mainTypeIdProvider);
    if (!mounted) return;
    final picked = await showModalBottomSheet<Product>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) {
        String query = '';
        int? typeFilter = mainTypeId; // 默认主营品类
        return StatefulBuilder(
          builder: (ctx, setModal) {
            var products = typeFilter == null ? all : all.where((p) => p.productTypeId == typeFilter).toList();
            products = products.where((p) => p.matches(query)).toList();
            return SafeArea(
              child: SizedBox(
                height: MediaQuery.of(ctx).size.height * 0.8,
                child: Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
                    child: Column(children: [
                      Align(alignment: Alignment.centerLeft, child: Text('进什么货？', style: Theme.of(ctx).textTheme.headlineMedium)),
                      const SizedBox(height: 10),
                      TextField(
                        onChanged: (v) => setModal(() => query = v),
                        textInputAction: TextInputAction.search,
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
                      if (types.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: SizedBox(
                            height: 34,
                            child: ListView(scrollDirection: Axis.horizontal, children: [
                              ChoiceChip(
                                label: const Text('全部', style: TextStyle(fontSize: 12)),
                                selected: typeFilter == null,
                                visualDensity: VisualDensity.compact,
                                onSelected: (_) => setModal(() => typeFilter = null),
                              ),
                              const SizedBox(width: 6),
                              for (final tp in types) ...[
                                ChoiceChip(
                                  label: Text(tp.name, style: const TextStyle(fontSize: 12)),
                                  selected: typeFilter == tp.id,
                                  visualDensity: VisualDensity.compact,
                                  onSelected: (_) => setModal(() => typeFilter = tp.id),
                                ),
                                const SizedBox(width: 6),
                              ],
                            ]),
                          ),
                        ),
                    ]),
                  ),
                  Expanded(
                    child: ListView(padding: const EdgeInsets.fromLTRB(20, 4, 20, 20), children: [
                      // 进货是新商品进店的唯一入口：路上补货发现新品，必须当场能建档
                      ListTile(
                        leading: const Icon(Icons.add_circle_outline, color: AppColors.primary),
                        title: const Text('找不到？快速新建商品', style: TextStyle(color: AppColors.primary, fontWeight: FontWeight.w600)),
                        onTap: () => Navigator.pop(ctx, _kPoQuickCreate),
                      ),
                      const Divider(height: 1),
                      if (products.isEmpty)
                        Padding(
                          padding: const EdgeInsets.all(20),
                          child: Text(query.isEmpty ? '还没有商品' : '没有匹配「$query」的商品，点上面快速新建'),
                        ),
                      for (final p in products)
                        ListTile(
                          leading: ProductThumb(imageUrl: p.imageUrl, name: p.name),
                          title: Text(p.name),
                          subtitle: Text(p.hasSpecs ? '${p.skus.length}个规格 · 总库存 ${p.totalStock}' : '库存 ${p.totalStock}'),
                          trailing: p.hasSpecs ? const Icon(Icons.chevron_right_rounded) : null,
                          onTap: () => Navigator.pop(ctx, p),
                        ),
                    ]),
                  ),
                ]),
              ),
            );
          },
        );
      },
    );
    if (picked == null || !mounted) return;
    if (identical(picked, _kPoQuickCreate)) {
      await _quickCreateProduct();
      return;
    }

    Sku? sku;
    if (picked.skus.length > 1) {
      sku = await showModalBottomSheet<Sku>(
        context: context,
        builder: (ctx) => SafeArea(
          child: ListView(padding: const EdgeInsets.all(20), shrinkWrap: true, children: [
            Text('${picked.name} · 进哪个规格？', style: Theme.of(ctx).textTheme.headlineMedium),
            const SizedBox(height: 12),
            for (final s in picked.skus)
              ListTile(
                title: Text(s.displayName),
                subtitle: Text('上次成本 ¥${s.costPrice ?? '-'} · 库存 ${s.stock}'),
                onTap: () => Navigator.pop(ctx, s),
              ),
          ]),
        ),
      );
      if (sku == null) return;
    } else {
      sku = picked.defaultSku;
      if (sku == null) return;
    }

    final existing = _items.where((i) => i.sku.id == sku!.id).firstOrNull;
    if (existing != null) {
      setState(() => existing.quantity++);
      return;
    }
    setState(() => _items.add(_PoItem(product: picked, sku: sku!, unitPrice: sku.costPrice ?? 0)));
    _saveDraft();
  }

  /// 进货现场快建商品：名称+售价+品类三填，建完直接入单填数量进价
  Future<void> _quickCreateProduct() async {
    final name = TextEditingController();
    final price = TextEditingController();
    int? typeId = ref.read(mainTypeIdProvider);
    final types = await ref.read(typesProvider.future);
    if (!mounted) return;
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModal) => Padding(
          padding: EdgeInsets.fromLTRB(24, 24, 24, MediaQuery.of(ctx).viewInsets.bottom + 24),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('快速新建商品', style: Theme.of(ctx).textTheme.headlineMedium),
            const SizedBox(height: 4),
            Text('先把货收进来，详细信息回头再补', style: Theme.of(ctx).textTheme.bodyMedium?.copyWith(fontSize: 12)),
            const SizedBox(height: 14),
            TextField(controller: name, autofocus: true, decoration: const InputDecoration(hintText: '商品名称 *')),
            const SizedBox(height: 10),
            TextField(controller: price, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(hintText: '零售价 ¥（可先不填）')),
            const SizedBox(height: 12),
            Wrap(spacing: 6, runSpacing: 6, children: [
              for (final tp in types)
                ChoiceChip(label: Text(tp.name), selected: typeId == tp.id, onSelected: (_) => setModal(() => typeId = tp.id)),
            ]),
            const SizedBox(height: 14),
            SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('建好并加入进货单'))),
          ]),
        ),
      ),
    );
    if (ok != true || name.text.trim().isEmpty || typeId == null) return;
    try {
      // strict=false 场景后端有兜底；用 batch 接口跳过必填字段（快建的意义就是先收货）
      final r = await Api.I.post('/products/batch', data: {
        'productTypeId': typeId,
        'products': [
          {
            'name': name.text.trim(),
            'unit': '件',
            'skus': [
              {'price': double.tryParse(price.text) ?? 0, 'initQuantity': 0}
            ],
          }
        ],
      });
      invalidateProducts(ref);
      final createdId = (r['createdIds'] as List?)?.firstOrNull ?? (r['ids'] as List?)?.firstOrNull;
      // 拉回完整商品对象入单
      final all = await ref.read(productsProvider(null).future);
      final created = createdId != null
          ? all.where((p) => p.id == createdId).firstOrNull
          : all.where((p) => p.name == name.text.trim()).firstOrNull;
      final sku = created?.defaultSku;
      if (created != null && sku != null) {
        setState(() => _items.add(_PoItem(product: created, sku: sku, unitPrice: 0)));
        _saveDraft();
        _toast('✓ 已建「${created.name}」，点它填数量和进价');
      }
    } catch (e) {
      _toast('$e');
    }
  }

  /// 扫码加货：扫到已建档商品直接入单；没建档先去建
  Future<void> _scanAdd() async {
    final code = await context.push<String>('/scan-code');
    if (code == null || code.isEmpty || !mounted) return;
    try {
      final data = await Api.I.post('/products/lookup', data: {'code': code});
      final product = Product.fromJson(data);
      final matched = data['matchedSku'] == null ? null : Sku.fromJson(data['matchedSku']);
      final sku = matched ?? product.defaultSku;
      if (sku == null) return;
      final existing = _items.where((i) => i.sku.id == sku.id).firstOrNull;
      if (existing != null) {
        setState(() => existing.quantity++);
      } else {
        setState(() => _items.add(_PoItem(product: product, sku: sku, unitPrice: sku.costPrice ?? 0)));
      }
      _saveDraft();
      _toast('✓ ${product.name}${sku.specText.isNotEmpty ? ' ${sku.specText}' : ''}');
    } catch (e) {
      if (e is ApiError && e.status == 404) {
        _toast('条码没建档，先去「商品」建这个货（条码会自动带上）');
        if (mounted) context.push('/products/new?barcode=${Uri.encodeComponent(code)}');
      } else {
        _toast('$e');
      }
    }
  }

  Future<void> _editItem(_PoItem item) async {
    final qty = TextEditingController(text: fmtQty(item.quantity));
    final price = TextEditingController(text: item.unitPrice.toString());
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(24, 24, 24, MediaQuery.of(ctx).viewInsets.bottom + 32),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${item.product.name}${item.sku.specText.isNotEmpty ? ' ${item.sku.specText}' : ''}',
              style: Theme.of(ctx).textTheme.headlineMedium),
          const SizedBox(height: 16),
          Row(children: [
            Expanded(child: TextField(controller: qty, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(hintText: '数量'))),
            const SizedBox(width: 12),
            Expanded(child: TextField(controller: price, keyboardType: TextInputType.number, decoration: const InputDecoration(hintText: '进价 ¥'))),
          ]),
          const SizedBox(height: 16),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('确定')),
        ]),
      ),
    );
    if (ok == true) {
      setState(() {
        item.quantity = double.tryParse(qty.text) ?? item.quantity;
        item.unitPrice = double.tryParse(price.text) ?? item.unitPrice;
      });
      _saveDraft();
    }
  }

  Future<void> _submit() async {
    if (_items.isEmpty) return _toast('还没加商品');
    if (_items.any((i) => i.unitPrice <= 0)) return _toast('有商品没填进价，点商品行修改');
    setState(() => _saving = true);
    try {
      final paid = double.tryParse(_paid.text);
      await Api.I.post('/purchase-orders', data: {
        if (_supplier != null) 'supplierId': _supplier!.id,
        if (paid != null) 'paidAmount': paid,
        if (_settlement != null) 'settlementAccount': _settlement,
        'items': [
          for (final i in _items) {'skuId': i.sku.id, 'quantity': i.quantity, 'unitPrice': i.unitPrice}
        ],
      });
      SharedPreferences.getInstance().then((sp) => sp.remove(_draftKey)); // 提交成功清草稿
      ref.invalidate(purchaseOrdersProvider);
      invalidateProducts(ref);
      ref.invalidate(overviewProvider);
      if (mounted) {
        _toast('✓ 进货入库成功');
        if (context.canPop()) context.pop();
      }
    } catch (e) {
      _toast('$e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final paidValue = double.tryParse(_paid.text);
    final owed = paidValue == null ? 0.0 : double.parse((_total - paidValue).toStringAsFixed(2));

    return Scaffold(
      appBar: AppBar(title: const Text('新建进货单')),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
          child: Row(children: [
            Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              Text('应付', style: t.bodyMedium?.copyWith(fontSize: 12)),
              Text('¥${_total.toStringAsFixed(2)}', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: AppColors.primary)),
            ]),
            const SizedBox(width: 20),
            Expanded(child: FilledButton(onPressed: _saving ? null : _submit, child: Text(_saving ? '提交中…' : '提交并入库'))),
          ]),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(kPagePadding, 8, kPagePadding, 40),
        children: [
          SoftCard(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
            onTap: _pickSupplier,
            child: Row(children: [
              const Icon(Icons.local_shipping_outlined, color: AppColors.primary),
              const SizedBox(width: 10),
              Expanded(child: Text(_supplier?.name ?? '选择供应商（选填）', style: t.titleMedium)),
              const Icon(Icons.chevron_right_rounded, color: AppColors.onSurfaceVariant),
            ]),
          ),
          const SizedBox(height: 16),
          for (final (i, item) in _items.indexed)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: SoftCard(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                onTap: () => _editItem(item),
                child: Row(children: [
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(item.sku.specText.isEmpty ? item.product.name : '${item.product.name} ${item.sku.specText}', style: t.titleMedium),
                      const SizedBox(height: 2),
                      Text(
                        item.unitPrice > 0 ? '进价 ¥${item.unitPrice} × ${item.quantity} = ¥${(item.unitPrice * item.quantity).toStringAsFixed(2)}' : '⚠ 点击填进价',
                        style: TextStyle(fontSize: 12, color: item.unitPrice > 0 ? AppColors.onSurfaceVariant : AppColors.warning),
                      ),
                    ]),
                  ),
                  IconButton(icon: const Icon(Icons.close_rounded, size: 20), onPressed: () => setState(() => _items.removeAt(i))),
                ]),
              ),
            ),
          Row(children: [
            Expanded(child: OutlinedButton.icon(onPressed: _addProduct, icon: const Icon(Icons.add, size: 18), label: const Text('添加商品'))),
            const SizedBox(width: 8),
            Expanded(child: OutlinedButton.icon(onPressed: _scanAdd, icon: const Icon(Icons.qr_code_scanner_rounded, size: 16), label: const Text('扫码'))),
            const SizedBox(width: 8),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: _ocrRunning ? null : _importFromPhoto,
                icon: _ocrRunning
                    ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.document_scanner_outlined, size: 16),
                label: const Text('拍单据'),
              ),
            ),
          ]),
          if (_items.isNotEmpty) ...[
            const SizedBox(height: 20),
            Text('付款', style: t.titleMedium),
            const SizedBox(height: 10),
            TextField(
              controller: _paid,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(hintText: '已付 ¥（默认付清 ${_total.toStringAsFixed(2)}，少付=欠供应商）'),
              onChanged: (_) => setState(() {}),
            ),
            if (paidValue != null && owed > 0)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text('将欠供应商 ¥${owed.toStringAsFixed(2)}', style: const TextStyle(fontSize: 12, color: AppColors.warning)),
              ),
            const SizedBox(height: 12),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final a in _accounts)
                ChoiceChip(label: Text(a), selected: _settlement == a, onSelected: (_) => setState(() => _settlement = _settlement == a ? null : a)),
            ]),
          ],
        ],
      ),
    );
  }
}
