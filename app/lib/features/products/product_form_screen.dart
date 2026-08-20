import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/api.dart';
import '../../core/pick_image.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';

/// 商品录入/编辑：
/// - 商品字段（scope=product）动态渲染
/// - 品类有规格维度（scope=sku）时出现「规格」编辑器，每个规格独立 价格/成本/条码/库存
/// - 无规格维度时保持单品体验（售价/成本/预警线 直接落默认规格）
class ProductFormScreen extends ConsumerStatefulWidget {
  final int? productId;
  final int? initialTypeId;
  final String? initialBarcode; // 扫码没找到→带着条码来建品，建完这个码就能扫了
  const ProductFormScreen({super.key, this.productId, this.initialTypeId, this.initialBarcode});

  @override
  ConsumerState<ProductFormScreen> createState() => _ProductFormScreenState();
}

/// 规格草稿（新建时本地暂存；编辑时对应已存在的 SKU）
class _SkuDraft {
  int? id; // 已存在的 SKU id
  Map<String, dynamic> specValues;
  double price;
  double? costPrice;
  String? barcode;
  String? imageUrl; // 规格图（同款不同色每色一张，无则回退商品图）
  double initQuantity;
  int minQuantity;
  double stock; // 服务端已知库存（编辑模式用来对比是否有改动）

  /// 库存输入框：库存直接在规格行上改，不藏在弹窗里
  final TextEditingController stockCtl = TextEditingController(text: '0');

  _SkuDraft({
    this.id,
    Map<String, dynamic>? specValues,
    this.price = 0,
    this.costPrice,
    this.barcode,
    this.imageUrl,
    this.initQuantity = 0,
    this.minQuantity = 0,
    this.stock = 0,
  }) : specValues = specValues ?? {};

  String label(List<FieldDef> skuFields) {
    if (specValues.isEmpty) return '默认规格';
    return specValues.entries.map((e) {
      final f = skuFields.where((x) => x.key == e.key).firstOrNull;
      return '${e.value}${f?.unit ?? ''}';
    }).join(' · ');
  }
}

class _ProductFormScreenState extends ConsumerState<ProductFormScreen> {
  final _name = TextEditingController();
  final _unit = TextEditingController(text: '件');
  final _price = TextEditingController();
  final _cost = TextEditingController();
  final _minQty = TextEditingController();
  int? _typeId;
  String? _imageUrl; // 商品图（相对路径）
  bool _uploading = false;
  final Map<String, dynamic> _custom = {};
  final List<_SkuDraft> _skus = [];
  bool _loading = false;

  /// 选图 → 上传 → 记 url
  Future<void> _pickImage() async {
    if (_uploading) return;
    final picked = await pickImageWithChoice(context, maxWidth: 1600, imageQuality: 85, cameraLabel: '拍商品照片');
    if (picked == null) return;
    setState(() => _uploading = true);
    try {
      final url = await Api.I.uploadImage(picked.path);
      setState(() => _imageUrl = url);
    } catch (e) {
      _toast('上传失败：$e');
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  bool get isNew => widget.productId == null;

  final _barcode = TextEditingController();

  @override
  void initState() {
    super.initState();
    _typeId = widget.initialTypeId;
    if (widget.initialBarcode != null) _barcode.text = widget.initialBarcode!;
    if (!isNew) _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final data = await Api.I.get('/products/${widget.productId}');
      final p = Product.fromJson(data);
      _name.text = p.name;
      _unit.text = p.unit;
      _price.text = p.defaultPrice.toString();
      _cost.text = p.costPrice?.toString() ?? '';
      _typeId = p.productTypeId;
      _imageUrl = p.imageUrl;
      _custom.addAll(p.customFields);
      _skus.clear();
      for (final s in p.skus) {
        _skus.add(_SkuDraft(
          id: s.id,
          specValues: Map.of(s.specValues),
          price: s.price,
          costPrice: s.costPrice,
          barcode: s.barcode,
          imageUrl: s.imageUrl,
          minQuantity: s.minQuantity,
          stock: s.stock,
        )..stockCtl.text = fmtQty(s.stock));
      }
      final def = p.defaultSku;
      if (def != null) _minQty.text = def.minQuantity.toString();
    } catch (e) {
      _toast('加载失败：$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// 必填字段有没有空着。后端本来就会拦（products.js validateFields），
  /// 这里做前置检查是为了「填完一长串才被服务端打回」变成「当场提示」。
  /// 返回所有没填的字段名，全填了返回空。
  List<String> _missingRequired(List<FieldDef> fields, Map<String, dynamic> values) {
    return [
      for (final f in fields)
        if (f.required)
          if (values[f.key] == null ||
              (values[f.key] is String && (values[f.key] as String).trim().isEmpty) ||
              (values[f.key] is List && (values[f.key] as List).isEmpty))
            f.label
    ];
  }

  Future<void> _save(List<FieldDef> skuFields, List<FieldDef> productFields) async {
    if (_name.text.trim().isEmpty) return _toast('请填写商品名称');
    if (_typeId == null) return _toast('请选择品类');
    final hasSpecDims = skuFields.isNotEmpty;
    if (hasSpecDims && isNew && _skus.isEmpty) return _toast('该品类有规格维度，请至少添加一个规格');
    // 商品字段必填前置检查（不做也会被后端拦，但要等一个来回且提示不定位）
    final missing = _missingRequired(productFields, _custom);
    if (missing.isNotEmpty) return _toast('还差 ${missing.length} 项必填：${missing.join("、")}');
    // 规格字段：报出是第几个规格缺哪几项
    for (final (i, s) in _skus.indexed) {
      final miss = _missingRequired(skuFields, s.specValues);
      if (miss.isNotEmpty) {
        return _toast('第 ${i + 1} 个规格还差：${miss.join("、")}，点规格右边的笔补一下');
      }
    }

    setState(() => _loading = true);
    try {
      if (isNew) {
        final body = {
          'name': _name.text.trim(),
          'productTypeId': _typeId,
          'unit': _unit.text.trim().isEmpty ? '件' : _unit.text.trim(),
          'defaultPrice': double.tryParse(_price.text) ?? 0,
          if (_cost.text.isNotEmpty) 'costPrice': double.tryParse(_cost.text),
          if (_minQty.text.isNotEmpty) 'minQuantity': int.tryParse(_minQty.text),
          if (_imageUrl != null) 'imageUrl': _imageUrl,
          if (_barcode.text.trim().isNotEmpty) 'barcode': _barcode.text.trim(),
          'customFields': _custom,
          if (_skus.isNotEmpty)
            'skus': [
              for (final s in _skus)
                {
                  'specValues': s.specValues,
                  'price': s.price,
                  if (s.costPrice != null) 'costPrice': s.costPrice,
                  if (s.barcode != null && s.barcode!.isNotEmpty) 'barcode': s.barcode,
                  if (s.imageUrl != null) 'imageUrl': s.imageUrl,
                  // 初始库存以规格行输入框为准
                  'initQuantity': double.tryParse(s.stockCtl.text.trim()) ?? s.initQuantity,
                  'minQuantity': s.minQuantity,
                }
            ],
        };
        await Api.I.post('/products', data: body);
      } else {
        await Api.I.put('/products/${widget.productId}', data: {
          'name': _name.text.trim(),
          'unit': _unit.text.trim().isEmpty ? '件' : _unit.text.trim(),
          'defaultPrice': double.tryParse(_price.text) ?? 0,
          if (_cost.text.isNotEmpty) 'costPrice': double.tryParse(_cost.text),
          if (_minQty.text.isNotEmpty) 'minQuantity': int.tryParse(_minQty.text),
          if (_imageUrl != null) 'imageUrl': _imageUrl,
          'customFields': _custom,
        });
      }
      // 规格行上改过的库存 → 调整落库（自动留流水）
      final adjusted = isNew ? 0 : await _applyStockChanges();
      invalidateProducts(ref);
      if (mounted) {
        _toast(isNew ? '✓ 商品已创建' : (adjusted > 0 ? '✓ 已保存，$adjusted 个规格的库存已更新' : '✓ 已保存'));
        if (context.canPop()) context.pop();
      }
    } catch (e) {
      _toast('$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _toast(String msg) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final types = ref.watch(typesProvider);
    // 新建商品默认落在主营品类（只做一门生意的人不用每次选）
    final mainTypeId = ref.watch(mainTypeIdProvider);
    if (isNew && _typeId == null && mainTypeId != null) _typeId = mainTypeId;

    return Scaffold(
      appBar: AppBar(title: Text(isNew ? '添加商品' : '编辑商品')),
      body: types.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('$e')),
        data: (typeList) {
          final selectedType = typeList.where((x) => x.id == _typeId).firstOrNull;
          final productFields = selectedType?.fields.where((f) => f.scope == 'product').toList() ?? [];
          final skuFields = selectedType?.fields.where((f) => f.scope == 'sku').toList() ?? [];
          final hasSpecDims = skuFields.isNotEmpty;

          return Column(children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(kPagePadding, 8, kPagePadding, 24),
                children: [
                  Text('选择品类', style: t.titleMedium),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final type in typeList)
                        ChoiceChip(
                          label: Text(type.name),
                          selected: _typeId == type.id,
                          onSelected: isNew ? (_) => setState(() => _typeId = type.id) : null,
                        ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  Text('基本信息', style: t.titleMedium),
                  const SizedBox(height: 10),
                  // 商品图（选填）
                  Row(children: [
                    GestureDetector(
                      onTap: _pickImage,
                      child: Container(
                        width: 72,
                        height: 72,
                        decoration: BoxDecoration(
                          color: const Color(0xFFF1F5F9),
                          borderRadius: BorderRadius.circular(16),
                          image: _imageUrl != null
                              ? DecorationImage(image: NetworkImage(Api.imageUrl(_imageUrl)), fit: BoxFit.cover)
                              : null,
                        ),
                        child: _uploading
                            ? const Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator(strokeWidth: 2))
                            : _imageUrl == null
                                ? const Icon(Icons.add_a_photo_outlined, color: AppColors.onSurfaceVariant)
                                : null,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(child: Text(_imageUrl == null ? '商品图（选填，点击上传）' : '已上传，点击可换图', style: t.bodyMedium?.copyWith(fontSize: 12))),
                    if (_imageUrl != null)
                      TextButton(onPressed: () => setState(() => _imageUrl = null), child: const Text('移除', style: TextStyle(fontSize: 12))),
                  ]),
                  const SizedBox(height: 12),
                  TextField(controller: _name, decoration: const InputDecoration(labelText: '商品名称')),
                  const SizedBox(height: 12),
                  Row(children: [
                    Expanded(child: TextField(controller: _unit, decoration: const InputDecoration(labelText: '单位（斤/瓶/箱…）'))),
                    if (!hasSpecDims) ...[
                      const SizedBox(width: 12),
                      Expanded(
                          child: TextField(
                              controller: _price, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: '售价 ¥'))),
                    ],
                  ]),
                  if (!hasSpecDims) ...[
                    const SizedBox(height: 12),
                    Row(children: [
                      Expanded(
                          child: TextField(
                              controller: _cost,
                              keyboardType: TextInputType.number,
                              decoration: const InputDecoration(labelText: '成本价 ¥（选填）'))),
                      const SizedBox(width: 12),
                      Expanded(
                          child: TextField(
                              controller: _minQty,
                              keyboardType: TextInputType.number,
                              decoration: const InputDecoration(labelText: '预警线（选填）'))),
                    ]),
                  ],
                  // ===== 规格编辑器（品类有规格维度时） =====
                  if (hasSpecDims) ...[
                    const SizedBox(height: 20),
                    Row(children: [
                      Expanded(child: Text('规格（${_skus.length}）', style: t.titleMedium)),
                      // 3色×4码=12个规格一个个敲是酷刑：按维度选项一键铺开
                      if (skuFields.any((f) => f.affectsStock && f.type == 'select' && (f.options?.isNotEmpty ?? false)))
                        TextButton.icon(
                          onPressed: () => _batchGenerateSkus(skuFields),
                          icon: const Icon(Icons.grid_on_rounded, size: 16),
                          label: const Text('批量生成'),
                        ),
                      TextButton.icon(
                        onPressed: () => _editSku(null, skuFields),
                        icon: const Icon(Icons.add, size: 18),
                        label: const Text('添加规格'),
                      ),
                    ]),
                    Text('每个规格独立价格和库存，如：500ml·53度 ¥168', style: t.bodyMedium?.copyWith(fontSize: 12)),
                    const SizedBox(height: 10),
                    for (final (i, s) in _skus.indexed)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: SoftCard(
                          padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
                          child: Column(children: [
                            Row(children: [
                              Expanded(
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Text(s.label(skuFields), style: t.titleMedium),
                                  const SizedBox(height: 2),
                                  Text(
                                    '¥${s.price}${s.costPrice != null ? ' · 成本¥${s.costPrice}' : ''}'
                                    '${s.barcode != null && s.barcode!.isNotEmpty ? ' · 条码${s.barcode}' : ''}',
                                    style: t.bodyMedium?.copyWith(fontSize: 12),
                                  ),
                                ]),
                              ),
                              if (!isNew && s.id != null)
                                IconButton(
                                  icon: const Icon(Icons.blender_outlined, size: 20),
                                  tooltip: '配方（卖1份扣哪些原料）',
                                  onPressed: () => _editRecipe(s),
                                ),
                              IconButton(
                                icon: const Icon(Icons.edit_outlined, size: 20),
                                tooltip: '改规格/价格',
                                onPressed: () => _editSku(i, skuFields),
                              ),
                              if (isNew || _skus.length > 1)
                                IconButton(
                                  icon: const Icon(Icons.delete_outline, size: 20, color: AppColors.error),
                                  onPressed: () => _removeSku(i),
                                ),
                            ]),
                            // 库存直接在规格行上改，不用点进弹窗
                            const SizedBox(height: 6),
                            Row(children: [
                              Text(isNew ? '初始库存' : '库存', style: t.bodyMedium?.copyWith(fontSize: 13)),
                              if (!isNew && _stockCtl(i).text != fmtQty(s.stock))
                                Padding(
                                  padding: const EdgeInsets.only(left: 6),
                                  child: Text('原 ${fmtQty(s.stock)}', style: const TextStyle(fontSize: 11, color: AppColors.onSurfaceVariant)),
                                ),
                              const Spacer(),
                              IconButton(
                                visualDensity: VisualDensity.compact,
                                icon: const Icon(Icons.remove_circle_outline, size: 22, color: AppColors.onSurfaceVariant),
                                onPressed: () => _bumpStock(i, -1),
                              ),
                              SizedBox(
                                width: 68,
                                child: TextField(
                                  controller: _stockCtl(i),
                                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                  textAlign: TextAlign.center,
                                  onChanged: (_) => setState(() {}),
                                  decoration: InputDecoration(
                                    isDense: true,
                                    contentPadding: const EdgeInsets.symmetric(horizontal: 6, vertical: 9),
                                    filled: true,
                                    fillColor: (!isNew && _stockCtl(i).text != fmtQty(s.stock))
                                        ? const Color(0xFFFFF4E5)
                                        : AppColors.surfaceContainer,
                                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                                  ),
                                ),
                              ),
                              IconButton(
                                visualDensity: VisualDensity.compact,
                                icon: const Icon(Icons.add_circle_outline, size: 22, color: AppColors.primary),
                                onPressed: () => _bumpStock(i, 1),
                              ),
                            ]),
                          ]),
                        ),
                      ),
                    if (!isNew && _stockDirtyCount > 0)
                      Padding(
                        padding: const EdgeInsets.only(top: 2, bottom: 4),
                        child: Row(children: [
                          const Icon(Icons.info_outline_rounded, size: 14, color: AppColors.warning),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text('$_stockDirtyCount 个规格的库存有改动，点「保存」后生效并留调整流水',
                                style: t.bodyMedium?.copyWith(fontSize: 12, color: AppColors.warning)),
                          ),
                        ]),
                      ),
                  ],
                  // ===== 商品字段（scope=product） =====
                  if (productFields.isNotEmpty) ...[
                    const SizedBox(height: 20),
                    Row(children: [
                      Text('${selectedType!.name}专属信息', style: t.titleMedium),
                      const SizedBox(width: 6),
                      const Icon(Icons.auto_awesome, size: 14, color: AppColors.primary),
                    ]),
                    const SizedBox(height: 10),
                    for (final f in productFields) ...[
                      DynamicFieldInput(
                        field: f,
                        value: _custom[f.key],
                        onChanged: (v) => setState(() {
                          if (v == null || (v is String && v.isEmpty)) {
                            _custom.remove(f.key);
                          } else {
                            _custom[f.key] = v;
                          }
                        }),
                      ),
                      const SizedBox(height: 12),
                    ],
                  ],
                ],
              ),
            ),
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 12),
                child: FilledButton(
                  onPressed: _loading ? null : () => _save(skuFields, productFields),
                  child: Text(_loading ? '保存中…' : '保存'),
                ),
              ),
            ),
          ]);
        },
      ),
    );
  }

  // ===== 规格行内联库存 =====
  TextEditingController _stockCtl(int i) => _skus[i].stockCtl;

  void _bumpStock(int i, int delta) {
    final cur = double.tryParse(_skus[i].stockCtl.text.trim()) ?? (isNew ? _skus[i].initQuantity : _skus[i].stock);
    final next = (cur + delta).clamp(0.0, 999999.0);
    setState(() => _skus[i].stockCtl.text = fmtQty(next));
  }

  /// 编辑模式下有几个规格的库存被改了（新建模式无所谓"改动"）
  int get _stockDirtyCount {
    if (isNew) return 0;
    return _skus.where((s) => (double.tryParse(s.stockCtl.text.trim()) ?? s.stock) != s.stock).length;
  }

  /// 把改过的库存落库（走 adjust，自动留流水）；返回实际调整条数
  Future<int> _applyStockChanges() async {
    var n = 0;
    for (final s in _skus) {
      if (s.id == null) continue;
      final v = double.tryParse(s.stockCtl.text.trim());
      if (v == null || v < 0 || v == s.stock) continue;
      await Api.I.post('/inventory/adjust', data: {'skuId': s.id, 'quantity': v, 'reason': '编辑商品时调整库存'});
      s.stock = v;
      n++;
    }
    return n;
  }

  Future<void> _removeSku(int index) async {
    final s = _skus[index];
    if (s.id != null && !isNew) {
      try {
        await Api.I.delete('/skus/${s.id}');
      } catch (e) {
        return _toast('$e');
      }
    }
    setState(() => _skus.removeAt(index));
  }

  /// M10 批量生成规格：勾选各维度要哪些值 → 笛卡尔积铺开 + 统一售价。
  /// 只用 affectsStock 的 select 维度——温度/糖度这类点单选项不该产生库存规格。
  Future<void> _batchGenerateSkus(List<FieldDef> skuFields) async {
    final dims = skuFields.where((f) => f.affectsStock && f.type == 'select' && (f.options?.isNotEmpty ?? false)).toList();
    if (dims.isEmpty) return;
    final selected = {for (final d in dims) d.key: <String>{...?d.options}}; // 默认全选
    final priceCtl = TextEditingController(text: _skus.firstOrNull?.price.toString() ?? '');
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModal) {
          final count = selected.values.fold(1, (a, v) => a * (v.isEmpty ? 1 : v.length));
          return Padding(
            padding: EdgeInsets.fromLTRB(24, 24, 24, MediaQuery.of(ctx).viewInsets.bottom + 24),
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('批量生成规格', style: Theme.of(ctx).textTheme.headlineMedium),
                const SizedBox(height: 4),
                Text('勾掉不卖的组合，价格生成后还能逐个改', style: Theme.of(ctx).textTheme.bodyMedium?.copyWith(fontSize: 12)),
                const SizedBox(height: 12),
                for (final d in dims) ...[
                  Text(d.label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 6),
                  Wrap(spacing: 6, runSpacing: 6, children: [
                    for (final o in d.options!)
                      FilterChip(
                        label: Text(o, style: const TextStyle(fontSize: 12)),
                        selected: selected[d.key]!.contains(o),
                        onSelected: (v) => setModal(() => v ? selected[d.key]!.add(o) : selected[d.key]!.remove(o)),
                      ),
                  ]),
                  const SizedBox(height: 10),
                ],
                TextField(
                  controller: priceCtl,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: '统一售价 ¥（生成后可逐个改）'),
                ),
                const SizedBox(height: 14),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: count > 0 && count <= 60 ? () => Navigator.pop(ctx, true) : null,
                    child: Text(count > 60 ? '组合太多（$count 个），先减掉一些值' : '生成 $count 个规格'),
                  ),
                ),
              ]),
            ),
          );
        },
      ),
    );
    if (ok != true) return;
    // 笛卡尔积
    var combos = <Map<String, dynamic>>[{}];
    for (final d in dims) {
      final vals = selected[d.key]!;
      if (vals.isEmpty) continue;
      combos = [
        for (final c in combos)
          for (final v in vals) {...c, d.key: v}
      ];
    }
    final price = double.tryParse(priceCtl.text) ?? 0;
    final existing = _skus.map((x) => _normSpec(x.specValues)).toSet();
    var added = 0;
    final newDrafts = <_SkuDraft>[];
    for (final c in combos) {
      if (existing.contains(_normSpec(c))) continue; // 已有的组合跳过
      newDrafts.add(_SkuDraft(specValues: c, price: price));
      added++;
    }
    // 编辑模式：直接落库
    if (!isNew) {
      for (final d in newDrafts) {
        try {
          final created = await Api.I.post('/products/${widget.productId}/skus', data: {
            'specValues': d.specValues,
            'price': d.price,
            'initQuantity': 0,
            'minQuantity': 0,
          });
          d.id = created['id'];
        } catch (e) {
          _toast('部分生成失败：$e');
          break;
        }
      }
      invalidateProducts(ref);
    }
    setState(() => _skus.addAll(newDrafts.where((d) => isNew || d.id != null)));
    _toast('✓ 生成 $added 个规格${combos.length - added > 0 ? '（跳过已存在 ${combos.length - added} 个）' : ''}');
  }

  String _normSpec(Map<String, dynamic> v) {
    final keys = v.keys.toList()..sort();
    return keys.map((k) => '$k=${v[k]}').join('|');
  }

  /// M35 配方编辑：奶茶/烘焙这类"卖成品扣原料"的生意。
  /// 设了配方后：卖 1 份这个规格 = 自动扣各原料用量；这个规格自身不追库存。
  Future<void> _editRecipe(_SkuDraft sku) async {
    List<Map<String, dynamic>> comps;
    try {
      comps = List<Map<String, dynamic>>.from(await Api.I.get('/skus/${sku.id}/recipe'));
    } catch (e) {
      return _toast('$e');
    }
    if (!mounted) return;
    final all = await ref.read(productsProvider(null).future);
    if (!mounted) return;
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModal) => Padding(
          padding: EdgeInsets.fromLTRB(24, 24, 24, MediaQuery.of(ctx).viewInsets.bottom + 24),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('配方 · ${sku.label(const [])}', style: Theme.of(ctx).textTheme.headlineMedium),
            const SizedBox(height: 4),
            Text('卖 1 份自动扣这些原料；设了配方后本规格自身不再追库存', style: Theme.of(ctx).textTheme.bodyMedium?.copyWith(fontSize: 12)),
            const SizedBox(height: 12),
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 300),
              child: ListView(shrinkWrap: true, children: [
                for (final (ci, c) in comps.indexed)
                  Row(children: [
                    Expanded(child: Text('${c['productName']}${(c['specText'] ?? '') != '' ? ' ${c['specText']}' : ''}', style: const TextStyle(fontSize: 13))),
                    SizedBox(
                      width: 76,
                      child: TextField(
                        controller: TextEditingController(text: fmtQty((c['qty'] as num).toDouble()))
                          ..selection = TextSelection.collapsed(offset: fmtQty((c['qty'] as num).toDouble()).length),
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        textAlign: TextAlign.center,
                        onChanged: (v) => c['qty'] = double.tryParse(v) ?? c['qty'],
                        decoration: const InputDecoration(isDense: true),
                      ),
                    ),
                    Text(' ${c['unit'] ?? ''}', style: const TextStyle(fontSize: 12, color: AppColors.onSurfaceVariant)),
                    IconButton(
                      icon: const Icon(Icons.close_rounded, size: 18),
                      onPressed: () => setModal(() => comps.removeAt(ci)),
                    ),
                  ]),
              ]),
            ),
            TextButton.icon(
              onPressed: () async {
                final picked = await showModalBottomSheet<(Product, Sku)>(
                  context: ctx,
                  builder: (c2) => SafeArea(
                    child: ListView(padding: const EdgeInsets.all(20), shrinkWrap: true, children: [
                      Text('选原料', style: Theme.of(c2).textTheme.headlineMedium),
                      for (final p in all)
                        if (p.id != widget.productId)
                          for (final k in p.skus)
                            ListTile(
                              dense: true,
                              title: Text(p.name + (k.specText.isNotEmpty ? ' ${k.specText}' : '')),
                              subtitle: Text('库存 ${fmtQty(k.stock)} ${p.unit}'),
                              onTap: () => Navigator.pop(c2, (p, k)),
                            ),
                    ]),
                  ),
                );
                if (picked != null && !comps.any((c) => c['componentSkuId'] == picked.$2.id)) {
                  setModal(() => comps.add({
                        'componentSkuId': picked.$2.id,
                        'qty': 1.0,
                        'productName': picked.$1.name,
                        'specText': picked.$2.specText,
                        'unit': picked.$1.unit,
                      }));
                }
              },
              icon: const Icon(Icons.add, size: 18),
              label: const Text('加原料'),
            ),
            const SizedBox(height: 8),
            SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('保存配方'))),
          ]),
        ),
      ),
    );
    if (ok != true) return;
    try {
      final r = await Api.I.put('/skus/${sku.id}/recipe', data: {
        'components': [
          for (final c in comps) {'componentSkuId': c['componentSkuId'], 'qty': c['qty']}
        ],
      });
      _toast('✓ ${r['count'] > 0 ? '配方已保存（${r['count']} 种原料）' : '配方已清空'}');
    } catch (e) {
      _toast('$e');
    }
  }

  /// 规格编辑弹层：规格维度字段 + 价格/成本/条码/预警线（库存在规格行上直接改，不放这儿）
  Future<void> _editSku(int? index, List<FieldDef> skuFields) async {
    final draft = index == null ? _SkuDraft() : _skus[index];
    final spec = Map<String, dynamic>.of(draft.specValues);
    final price = TextEditingController(text: draft.price == 0 ? '' : draft.price.toString());
    final cost = TextEditingController(text: draft.costPrice?.toString() ?? '');
    final barcode = TextEditingController(text: draft.barcode ?? '');
    String? skuImage = draft.imageUrl;
    final minQty = TextEditingController(text: draft.minQuantity == 0 ? '' : draft.minQuantity.toString());

    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModal) => Padding(
          padding: EdgeInsets.fromLTRB(24, 24, 24, MediaQuery.of(ctx).viewInsets.bottom + 32),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(index == null ? '添加规格' : '编辑规格', style: Theme.of(ctx).textTheme.headlineMedium),
                const SizedBox(height: 16),
                for (final f in skuFields) ...[
                  DynamicFieldInput(
                    field: f,
                    value: spec[f.key],
                    onChanged: (v) => setModal(() {
                      if (v == null || (v is String && v.isEmpty)) {
                        spec.remove(f.key);
                      } else {
                        spec[f.key] = v;
                      }
                    }),
                  ),
                  const SizedBox(height: 12),
                ],
                Row(children: [
                  Expanded(
                      child: TextField(
                          controller: price, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: '售价 ¥ *'))),
                  const SizedBox(width: 12),
                  Expanded(
                      child: TextField(
                          controller: cost, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: '成本 ¥'))),
                ]),
                const SizedBox(height: 12),
                TextField(controller: barcode, decoration: const InputDecoration(labelText: '条形码（选填，扫码用）')),
                const SizedBox(height: 12),
                // 规格图：服装同款不同色，每个颜色一张（列表/选货处优先用它）
                Row(children: [
                  GestureDetector(
                    onTap: () async {
                      final picked = await pickImageWithChoice(context, maxWidth: 1200, imageQuality: 85, cameraLabel: '拍商品照片');
                      if (picked == null) return;
                      try {
                        final url = await Api.I.uploadImage(picked.path);
                        setModal(() => skuImage = url);
                      } catch (e) {
                        if (ctx.mounted) ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text('上传失败：$e')));
                      }
                    },
                    child: skuImage == null
                        ? Container(
                            width: 52,
                            height: 52,
                            decoration: BoxDecoration(color: AppColors.surfaceContainer, borderRadius: BorderRadius.circular(12)),
                            child: const Icon(Icons.add_a_photo_outlined, size: 20, color: AppColors.onSurfaceVariant),
                          )
                        : ClipRRect(
                            borderRadius: BorderRadius.circular(12),
                            child: Image.network(Api.imageUrl(skuImage), width: 52, height: 52, fit: BoxFit.cover),
                          ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(child: Text('规格图（选填，同款不同色时每色一张）', style: Theme.of(ctx).textTheme.bodyMedium?.copyWith(fontSize: 12))),
                  if (skuImage != null)
                    TextButton(onPressed: () => setModal(() => skuImage = null), child: const Text('移除', style: TextStyle(fontSize: 12))),
                ]),
                const SizedBox(height: 12),
                TextField(
                  controller: minQty,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: '预警线', hintText: '低于这个数提醒补货'),
                ),
                const SizedBox(height: 8),
                Text('库存在下面的规格行上直接加减，不用进这里改', style: Theme.of(ctx).textTheme.bodyMedium?.copyWith(fontSize: 12)),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: () {
                    // 规格维度里标了必填的，这里就拦住，别让缺项的规格建出来
                    final miss = _missingRequired(skuFields, spec);
                    if (miss.isNotEmpty) {
                      ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text('还差必填：${miss.join("、")}')));
                      return;
                    }
                    Navigator.pop(ctx, true);
                  },
                  child: const Text('确定'),
                ),
              ],
            ),
          ),
        ),
      ),
    );

    if (saved != true) return;
    final p = double.tryParse(price.text) ?? 0;
    // 库存值来自规格行的输入框，这里只搬运（新建规格默认 0）
    final stockText = index == null ? '0' : draft.stockCtl.text;
    final newDraft = _SkuDraft(
      id: draft.id,
      specValues: spec,
      price: p,
      costPrice: double.tryParse(cost.text),
      barcode: barcode.text.trim().isEmpty ? null : barcode.text.trim(),
      imageUrl: skuImage,
      initQuantity: double.tryParse(stockText) ?? 0,
      minQuantity: int.tryParse(minQty.text) ?? 0,
      stock: draft.stock,
    )..stockCtl.text = stockText;

    // 编辑模式：直接调 API
    if (!isNew) {
      try {
        if (newDraft.id == null) {
          final created = await Api.I.post('/products/${widget.productId}/skus', data: {
            'specValues': newDraft.specValues,
            'price': newDraft.price,
            if (newDraft.costPrice != null) 'costPrice': newDraft.costPrice,
            if (newDraft.barcode != null) 'barcode': newDraft.barcode,
            if (newDraft.imageUrl != null) 'imageUrl': newDraft.imageUrl,
            'initQuantity': newDraft.initQuantity,
            'minQuantity': newDraft.minQuantity,
          });
          newDraft.id = created['id'];
          newDraft.stock = newDraft.initQuantity; // 新建规格的库存已随 initQuantity 落库
        } else {
          await Api.I.put('/skus/${newDraft.id}', data: {
            'specValues': newDraft.specValues,
            'price': newDraft.price,
            if (newDraft.costPrice != null) 'costPrice': newDraft.costPrice,
            if (newDraft.barcode != null) 'barcode': newDraft.barcode,
            'imageUrl': newDraft.imageUrl, // null=清除
            'minQuantity': newDraft.minQuantity,
          });
        }
        invalidateProducts(ref);
      } catch (e) {
        return _toast('$e');
      }
    }

    setState(() {
      if (index == null) {
        _skus.add(newDraft);
      } else {
        _skus[index] = newDraft;
      }
    });
  }
}

/// 单个动态字段控件（商品字段 / 规格维度共用）
class DynamicFieldInput extends StatelessWidget {
  final FieldDef field;
  final dynamic value;
  final ValueChanged<dynamic> onChanged;
  const DynamicFieldInput({super.key, required this.field, required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final label = field.required ? '${field.label} *' : field.label;

    switch (field.type) {
      case 'select':
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: t.bodyMedium),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final opt in field.options ?? [])
                  ChoiceChip(label: Text(opt), selected: value == opt, onSelected: (_) => onChanged(value == opt ? null : opt)),
              ],
            ),
          ],
        );
      case 'boolean':
        return Row(children: [
          Expanded(child: Text(label, style: t.bodyLarge)),
          Switch(value: value == true, onChanged: onChanged),
        ]);
      case 'date':
        return GestureDetector(
          onTap: () async {
            final picked = await showDatePicker(
              context: context,
              initialDate: DateTime.now(),
              firstDate: DateTime(2000),
              lastDate: DateTime(2100),
            );
            if (picked != null) onChanged(picked.toIso8601String().substring(0, 10));
          },
          child: InputDecorator(
            decoration: InputDecoration(labelText: label),
            // isEmpty 决定标签是"占位"还是"浮到框顶"。没它的话空状态会把标签显示两遍
            isEmpty: value == null,
            child: value == null ? const SizedBox(height: 20) : Text(value.toString()),
          ),
        );
      case 'number':
        return TextFormField(
          initialValue: value?.toString() ?? '',
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(labelText: label, suffixText: field.unit),
          onChanged: (v) => onChanged(double.tryParse(v)),
        );
      default:
        return TextFormField(
          initialValue: value?.toString() ?? '',
          decoration: InputDecoration(labelText: label),
          onChanged: onChanged,
        );
    }
  }
}
