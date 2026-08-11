import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/api.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';

/// 品类页
/// - 编辑已有品类：双 Tab「商品」（该品类下的货+库存，默认页）/「字段设置」（名称+字段配置）
/// - 新建品类：单页编辑器（名称 + AI 生成 + 字段）
class TypeEditScreen extends ConsumerStatefulWidget {
  final int? typeId; // 编辑已有
  final String? aiTheme; // 新建时的 AI 主题
  const TypeEditScreen({super.key, this.typeId, this.aiTheme});

  @override
  ConsumerState<TypeEditScreen> createState() => _TypeEditScreenState();
}

class _TypeEditScreenState extends ConsumerState<TypeEditScreen> {
  final _name = TextEditingController();
  List<FieldDef> _fields = [];
  bool _loading = false;
  bool _aiGenerating = false;
  String? _aiSource;

  bool get isNew => widget.typeId == null;

  @override
  void initState() {
    super.initState();
    if (isNew) {
      if (widget.aiTheme != null) {
        _name.text = widget.aiTheme!;
        _generateWithAi(widget.aiTheme!);
      }
    } else {
      _loadExisting();
    }
  }

  Future<void> _loadExisting() async {
    setState(() => _loading = true);
    try {
      final data = await Api.I.get('/product-types/${widget.typeId}');
      final type = ProductType.fromJson(data);
      _name.text = type.name;
      _fields = List.of(type.fields);
    } catch (e) {
      _toast('加载失败：$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _generateWithAi(String theme) async {
    setState(() => _aiGenerating = true);
    try {
      final data = await Api.I.post('/ai/generate-fields', data: {'theme': theme});
      // v2：两层字段——商品描述字段(fields) + 规格维度(specs)
      final fields = (data['fields'] as List? ?? [])
          .map((f) => FieldDef.fromJson({...f, 'scope': 'product', 'required': f['required'] == true ? 1 : 0}))
          .toList();
      final specs = (data['specs'] as List? ?? [])
          .map((f) => FieldDef.fromJson({...f, 'scope': 'sku', 'required': f['required'] == true ? 1 : 0}))
          .toList();
      setState(() {
        _fields = [...fields, ...specs];
        _aiSource = data['source'];
      });
    } catch (e) {
      _toast('AI 生成失败：$e');
    } finally {
      if (mounted) setState(() => _aiGenerating = false);
    }
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    if (name.isEmpty) return _toast('请填写品类名称');
    if (_fields.isEmpty) return _toast('至少要有一个字段');
    setState(() => _loading = true);
    bool saved = false;
    try {
      if (isNew) {
        await Api.I.post('/product-types', data: {
          'name': name,
          'fields': [for (final (i, f) in _fields.indexed) {...f.toJson(), 'sortOrder': i}],
        });
      } else {
        await Api.I.put('/product-types/${widget.typeId}', data: {'name': name});
        for (final (i, f) in _fields.indexed) {
          if (f.id == null) {
            await Api.I.post('/product-types/${widget.typeId}/fields', data: {...f.toJson(), 'sortOrder': i});
          }
        }
      }
      saved = true;
      ref.invalidate(typesProvider);
    } catch (e) {
      _toast('保存失败：$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
    if (!saved || !mounted) return;
    _toast(isNew ? '✓ 品类已创建' : '✓ 已保存');
    // 新建完成回列表；编辑保存后留在原页（没有可退的页面时不硬退——修 GoError bug）
    if (isNew) {
      if (context.canPop()) {
        context.pop();
      } else {
        context.go('/types');
      }
    }
  }

  Future<void> _removeField(int index) async {
    final f = _fields[index];
    if (f.id != null && !isNew) {
      try {
        await Api.I.delete('/product-types/${widget.typeId}/fields/${f.id}');
      } catch (e) {
        return _toast('删除失败：$e');
      }
    }
    setState(() => _fields.removeAt(index));
  }

  void _toast(String msg) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  @override
  Widget build(BuildContext context) {
    // 新建：单页编辑器
    if (isNew) {
      return Scaffold(
        appBar: AppBar(
          title: const Text('新建品类'),
          actions: [
            TextButton(onPressed: _loading ? null : _save, child: const Text('保存', style: TextStyle(fontWeight: FontWeight.w700)))
          ],
        ),
        body: _buildFieldsEditor(showAiButton: true),
      );
    }

    // 编辑：双 Tab（商品 | 字段设置）
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: Text(_name.text.isEmpty ? '品类' : _name.text),
          actions: [
            TextButton(onPressed: _loading ? null : _save, child: const Text('保存', style: TextStyle(fontWeight: FontWeight.w700)))
          ],
          bottom: TabBar(
            labelColor: AppColors.primary,
            unselectedLabelColor: AppColors.onSurfaceVariant,
            indicatorColor: AppColors.primary,
            indicatorSize: TabBarIndicatorSize.label,
            dividerColor: Colors.transparent,
            labelStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
            tabs: const [Tab(text: '商品'), Tab(text: '字段设置')],
          ),
        ),
        body: _loading && _fields.isEmpty
            ? const Center(child: CircularProgressIndicator())
            : TabBarView(
                children: [
                  // Tab1：该品类下的货（默认页）
                  ListView(
                    padding: const EdgeInsets.fromLTRB(kPagePadding, 16, kPagePadding, 120),
                    children: [_TypeProducts(typeId: widget.typeId!)],
                  ),
                  // Tab2：名称 + 字段配置
                  _buildFieldsEditor(showAiButton: false),
                ],
              ),
      ),
    );
  }

  /// 字段编辑器（新建单页 / 编辑 Tab2 共用）
  Widget _buildFieldsEditor({required bool showAiButton}) {
    final t = Theme.of(context).textTheme;
    return ListView(
      padding: const EdgeInsets.fromLTRB(kPagePadding, 16, kPagePadding, 120),
      children: [
        Text('品类名称', style: t.labelMedium),
        const SizedBox(height: 8),
        TextField(controller: _name, decoration: const InputDecoration(hintText: '品类名称，如：奶茶店物料')),
        const SizedBox(height: 16),
        if (showAiButton)
          OutlinedButton.icon(
            onPressed: _aiGenerating ? null : () => _generateWithAi(_name.text.trim().isEmpty ? '通用商品' : _name.text.trim()),
            icon: _aiGenerating
                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.auto_awesome, size: 18),
            label: Text(_aiGenerating ? 'AI 生成中…' : (_fields.isEmpty ? 'AI 生成字段' : 'AI 重新生成')),
          ),
        if (_aiSource == 'deepseek')
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Row(children: [
              const Icon(Icons.auto_awesome, size: 14, color: AppColors.primary),
              const SizedBox(width: 4),
              Text('AI 已生成，可随意改', style: t.bodyMedium?.copyWith(fontSize: 12, color: AppColors.primary)),
            ]),
          ),
        const SizedBox(height: 20),
        // 商品描述字段
        Text('商品字段（${_fields.where((f) => f.scope == 'product').length}）', style: t.titleMedium),
        const SizedBox(height: 4),
        Text('描述"这是什么商品"，如品牌/产地', style: t.bodyMedium?.copyWith(fontSize: 12)),
        const SizedBox(height: 12),
        for (final (i, f) in _fields.indexed)
          if (f.scope == 'product') _fieldCard(i, f, t),
        // 规格维度
        const SizedBox(height: 16),
        Row(children: [
          Text('规格维度（${_fields.where((f) => f.scope == 'sku').length}）', style: t.titleMedium),
          const SizedBox(width: 6),
          const Icon(Icons.tune_rounded, size: 16, color: AppColors.primary),
        ]),
        const SizedBox(height: 4),
        Text('会产生不同价格/库存的维度，如 度数/容量/包装。同一商品可按这些维度建多个规格', style: t.bodyMedium?.copyWith(fontSize: 12)),
        const SizedBox(height: 12),
        for (final (i, f) in _fields.indexed)
          if (f.scope == 'sku') _fieldCard(i, f, t),
        const SizedBox(height: 8),
        OutlinedButton.icon(onPressed: () => _editField(null), icon: const Icon(Icons.add), label: const Text('添加字段')),
      ],
    );
  }

  Widget _fieldCard(int i, FieldDef f, TextTheme t) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: SoftCard(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Text(f.label, style: t.titleMedium),
                    if (f.required)
                      const Padding(
                        padding: EdgeInsets.only(left: 6),
                        child: Text('必填', style: TextStyle(fontSize: 11, color: AppColors.error)),
                      ),
                  ]),
                  const SizedBox(height: 2),
                  Text(
                    [_typeName(f.type), if (f.unit != null) f.unit!, if (f.options != null) f.options!.join('/')].join(' · '),
                    style: t.bodyMedium?.copyWith(fontSize: 12),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            IconButton(icon: const Icon(Icons.edit_outlined, size: 20), onPressed: () => _editField(i)),
            IconButton(icon: const Icon(Icons.delete_outline, size: 20, color: AppColors.error), onPressed: () => _removeField(i)),
          ],
        ),
      ),
    );
  }

  String _typeName(String type) => switch (type) {
        'number' => '数字',
        'select' => '下拉选择',
        'date' => '日期',
        'boolean' => '开关',
        _ => '文本',
      };

  /// 字段编辑弹层（新增 index=null / 编辑 index!=null）
  Future<void> _editField(int? index) async {
    final f = index == null ? FieldDef(key: '', label: '') : _fields[index];
    final label = TextEditingController(text: f.label);
    final key = TextEditingController(text: f.key);
    final unit = TextEditingController(text: f.unit ?? '');
    final options = TextEditingController(text: f.options?.join('、') ?? '');
    String type = f.type;
    String scope = f.scope;
    bool required = f.required;
    bool affectsStock = f.affectsStock;
    bool showInList = f.showInList;

    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModal) => Padding(
          padding: EdgeInsets.fromLTRB(24, 24, 24, MediaQuery.of(ctx).viewInsets.bottom + 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(index == null ? '添加字段' : '编辑字段', style: Theme.of(ctx).textTheme.headlineMedium),
              const SizedBox(height: 16),
              // 字段归属：商品描述 or 规格维度
              Row(children: [
                Expanded(
                  child: ChoiceChip(
                    label: const Center(child: Text('商品字段')),
                    selected: scope == 'product',
                    onSelected: (_) => setModal(() => scope = 'product'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: ChoiceChip(
                    label: const Center(child: Text('规格维度')),
                    selected: scope == 'sku',
                    onSelected: (_) => setModal(() => scope = 'sku'),
                  ),
                ),
              ]),
              const SizedBox(height: 12),
              TextField(controller: label, decoration: const InputDecoration(hintText: '字段名（如：口味）')),
              const SizedBox(height: 12),
              TextField(controller: key, decoration: const InputDecoration(hintText: '英文标识（如 flavor，留空自动生成）')),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                children: [
                  for (final tp in ['text', 'number', 'select', 'date', 'boolean'])
                    ChoiceChip(label: Text(_typeName(tp)), selected: type == tp, onSelected: (_) => setModal(() => type = tp)),
                ],
              ),
              const SizedBox(height: 12),
              if (type == 'number') TextField(controller: unit, decoration: const InputDecoration(hintText: '单位（如：斤 / ml / 天）')),
              if (type == 'select')
                TextField(controller: options, decoration: const InputDecoration(hintText: '选项，用、分隔（如：原味、辣味）')),
              const SizedBox(height: 12),
              Row(children: [
                Switch(value: required, onChanged: (v) => setModal(() => required = v)),
                const Text('必填'),
              ]),
              // 规格维度才有的开关：是否产生独立库存
              if (scope == 'sku')
                Row(children: [
                  Switch(value: affectsStock, onChanged: (v) => setModal(() => affectsStock = v)),
                  const Expanded(
                    child: Text('产生库存规格（关掉=温度/糖度这类点单选项，不单独备货）', style: TextStyle(fontSize: 12)),
                  ),
                ]),
              if (scope == 'product')
                Row(children: [
                  Switch(value: showInList, onChanged: (v) => setModal(() => showInList = v)),
                  const Expanded(
                    child: Text('在商品列表显示（同名药靠"厂家"区分就开这个）', style: TextStyle(fontSize: 12)),
                  ),
                ]),
              const SizedBox(height: 16),
              FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('确定')),
            ],
          ),
        ),
      ),
    );

    if (saved != true) return;
    final labelText = label.text.trim();
    if (labelText.isEmpty) return;
    var keyText = key.text.trim();
    if (keyText.isEmpty) {
      keyText = 'field_${DateTime.now().millisecondsSinceEpoch % 100000}';
    }
    final newField = FieldDef(
      key: keyText,
      label: labelText,
      type: type,
      scope: scope,
      unit: unit.text.trim().isEmpty ? null : unit.text.trim(),
      options: type == 'select' && options.text.trim().isNotEmpty
          ? options.text.trim().split(RegExp(r'[、,，]')).map((s) => s.trim()).where((s) => s.isNotEmpty).toList()
          : null,
      required: required,
      affectsStock: affectsStock,
      showInList: showInList,
    );
    setState(() {
      if (index == null) {
        _fields.add(newField);
      } else {
        _fields[index] = newField;
      }
    });
  }
}

/// 品类下的商品清单：真实产品 + 库存数量 + 批量建品（AI 生成/粘贴导入）
class _TypeProducts extends ConsumerWidget {
  final int typeId;
  const _TypeProducts({required this.typeId});

  void _toast(BuildContext context, String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  /// AI 按品类生成常见商品建议
  Future<void> _aiGenerate(BuildContext context, WidgetRef ref) async {
    _toast(context, 'AI 生成中，几秒钟…');
    try {
      final data = await Api.I.post('/ai/generate-products', data: {'productTypeId': typeId, 'count': 8});
      if (!context.mounted) return;
      await _showDraftSheet(context, ref, List<Map<String, dynamic>>.from(data['products']), source: 'AI 生成');
    } catch (e) {
      if (context.mounted) _toast(context, '$e');
    }
  }

  /// 粘贴导入：从旧系统/Excel/微信复制的任意表格文字 → AI 解析
  Future<void> _pasteImport(BuildContext context, WidgetRef ref) async {
    final textC = TextEditingController();
    final submitted = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(24, 24, 24, MediaQuery.of(ctx).viewInsets.bottom + 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('粘贴导入 / 一键搬家', style: Theme.of(ctx).textTheme.headlineMedium),
            const SizedBox(height: 4),
            Text('从旧系统/Excel/微信里复制商品数据，粘贴到这里，格式随意，AI 会整理。\n'
                '从智慧记/秦丝搬家：旧软件里导出商品 Excel → 打开后全选复制 → 粘贴到这里即可。',
                style: Theme.of(ctx).textTheme.bodyMedium),
            const SizedBox(height: 14),
            TextField(
              controller: textC,
              autofocus: true,
              maxLines: 8,
              decoration: const InputDecoration(hintText: '例如：\n感冒灵颗粒 10袋/盒 零售12 进价8 库存45\n布洛芬0.3g*24粒 售19.9 成本13 存32'),
            ),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: () => Navigator.pop(ctx, true),
              icon: const Icon(Icons.auto_awesome, size: 18),
              label: const Text('AI 解析'),
            ),
          ],
        ),
      ),
    );
    if (submitted != true || textC.text.trim().length < 2 || !context.mounted) return;
    _toast(context, 'AI 解析中，几秒钟…');
    try {
      final data = await Api.I.post('/ai/import-products', data: {'productTypeId': typeId, 'text': textC.text.trim()});
      if (!context.mounted) return;
      final skipped = List<String>.from(data['skipped'] ?? []);
      await _showDraftSheet(context, ref, List<Map<String, dynamic>>.from(data['products']),
          source: '粘贴导入', skipped: skipped);
    } catch (e) {
      if (context.mounted) _toast(context, '$e');
    }
  }

  /// 草案确认单：勾选要创建的商品 → 批量落库
  Future<void> _showDraftSheet(BuildContext context, WidgetRef ref, List<Map<String, dynamic>> drafts,
      {required String source, List<String> skipped = const []}) async {
    if (drafts.isEmpty) {
      _toast(context, '$source没有解析出商品');
      return;
    }
    final selected = {for (var i = 0; i < drafts.length; i++) i};
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModal) => SafeArea(
          child: SizedBox(
            height: MediaQuery.of(ctx).size.height * 0.8,
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('$source · 确认创建', style: Theme.of(ctx).textTheme.headlineMedium),
                const SizedBox(height: 4),
                Text('勾选要创建的商品（可先取消不要的），创建后可再编辑', style: Theme.of(ctx).textTheme.bodyMedium),
                const SizedBox(height: 10),
                Expanded(
                  child: ListView(children: [
                    for (final (i, p) in drafts.indexed)
                      CheckboxListTile(
                        value: selected.contains(i),
                        onChanged: (v) => setModal(() => v == true ? selected.add(i) : selected.remove(i)),
                        controlAffinity: ListTileControlAffinity.leading,
                        title: Text('${p['name']}（${p['unit'] ?? '件'}）'),
                        subtitle: Text(
                          (p['skus'] as List? ?? [])
                              .map((s) =>
                                  '${(s['specValues'] as Map?)?.values.join('/') ?? ''} ¥${s['price'] ?? 0}${s['initQuantity'] != null && s['initQuantity'] > 0 ? ' 库存${s['initQuantity']}' : ''}')
                              .join(' | '),
                          style: const TextStyle(fontSize: 12),
                        ),
                      ),
                    if (skipped.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.all(8),
                        child: Text('未能解析：${skipped.join('；')}', style: const TextStyle(fontSize: 12, color: AppColors.warning)),
                      ),
                  ]),
                ),
                FilledButton(
                  onPressed: selected.isEmpty ? null : () => Navigator.pop(ctx, true),
                  child: Text('创建选中的 ${selected.length} 个商品'),
                ),
              ]),
            ),
          ),
        ),
      ),
    );
    if (confirmed != true || !context.mounted) return;
    try {
      final data = await Api.I.post('/products/batch', data: {
        'productTypeId': typeId,
        'products': [for (final i in selected) drafts[i]],
      });
      invalidateProducts(ref);
      ref.invalidate(typesProvider);
      if (context.mounted) {
        final failed = List.from(data['failed'] ?? []);
        _toast(context, '✓ 创建 ${(data['created'] as List).length} 个${failed.isNotEmpty ? '，失败 ${failed.length} 个' : ''}');
      }
    } catch (e) {
      if (context.mounted) _toast(context, '$e');
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = Theme.of(context).textTheme;
    final products = ref.watch(productsProvider(typeId));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          Expanded(child: Text('该品类下的商品', style: t.titleMedium)),
          TextButton.icon(
            onPressed: () async {
              await context.push('/products/new?typeId=$typeId');
              invalidateProducts(ref);
            },
            icon: const Icon(Icons.add, size: 18),
            label: const Text('添加商品'),
          ),
        ]),
        const SizedBox(height: 6),
        // 批量建品：AI 生成 / 粘贴导入
        Row(children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: () => _aiGenerate(context, ref),
              icon: const Icon(Icons.auto_awesome, size: 16),
              label: const Text('AI 生成商品', style: TextStyle(fontSize: 13)),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: OutlinedButton.icon(
              onPressed: () => _pasteImport(context, ref),
              icon: const Icon(Icons.content_paste_go_rounded, size: 16),
              label: const Text('粘贴导入', style: TextStyle(fontSize: 13)),
            ),
          ),
        ]),
        const SizedBox(height: 10),
        products.when(
          loading: () => const Padding(padding: EdgeInsets.all(20), child: Center(child: CircularProgressIndicator())),
          error: (e, _) => Text('加载失败：$e', style: t.bodyMedium),
          data: (list) => list.isEmpty
              ? SoftCard(
                  padding: const EdgeInsets.all(18),
                  child: Text('还没有商品。比如「馄饨」品类下可以加：虾仁馄饨、芹菜馄饨…每个商品独立管库存。', style: t.bodyMedium),
                )
              : Column(children: [
                  for (final p in list)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: SoftCard(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                        onTap: () async {
                          await context.push('/products/${p.id}/edit');
                          invalidateProducts(ref);
                        },
                        child: Row(children: [
                          Expanded(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text(p.name, style: t.titleMedium),
                              const SizedBox(height: 2),
                              Text(
                                p.hasSpecs ? '${p.skus.length}个规格 · ¥${p.skus.map((s) => s.price).reduce((a, b) => a < b ? a : b)}起' : '¥${p.defaultPrice} / ${p.unit}',
                                style: t.bodyMedium?.copyWith(fontSize: 12),
                              ),
                            ]),
                          ),
                          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                            Text('${p.totalStock}',
                                style: TextStyle(
                                    fontSize: 20,
                                    fontWeight: FontWeight.w800,
                                    color: p.isLow ? AppColors.error : AppColors.onSurface)),
                            Text(p.isLow ? '有规格缺货' : '总库存',
                                style:
                                    TextStyle(fontSize: 11, color: p.isLow ? AppColors.error : AppColors.onSurfaceVariant)),
                          ]),
                        ]),
                      ),
                    ),
                ]),
        ),
      ],
    );
  }
}
