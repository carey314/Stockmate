import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../core/api.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';

final _dt = DateFormat('MM-dd HH:mm');

final stocktakeListProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final d = await Api.I.get('/stocktakes?pageSize=50');
  return List<Map<String, dynamic>>.from(d['list']);
});

/// 盘点单历史：每张单是一次「实盘 → 盘盈亏自动调库存」的记录
class StocktakeListScreen extends ConsumerWidget {
  const StocktakeListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final list = ref.watch(stocktakeListProvider);
    final t = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('盘点单')),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'stocktake_new',
        onPressed: () async {
          await context.push('/stocktakes/new');
          ref.invalidate(stocktakeListProvider);
        },
        icon: const Icon(Icons.fact_check_outlined),
        label: const Text('开始盘点'),
      ),
      body: list.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('$e')),
        data: (rows) => rows.isEmpty
            ? Center(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.fact_check_outlined, size: 56, color: AppColors.onSurfaceVariant),
                  const SizedBox(height: 12),
                  Text('还没盘过库', style: t.titleMedium),
                  const SizedBox(height: 4),
                  Text('点右下角开始第一次盘点\n实盘数和账面不一致时会自动调平库存', textAlign: TextAlign.center, style: t.bodyMedium?.copyWith(fontSize: 12)),
                ]),
              )
            : RefreshIndicator(
                onRefresh: () async => ref.invalidate(stocktakeListProvider),
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(kPagePadding, 8, kPagePadding, 120),
                  children: [
                    for (final s in rows)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: SoftCard(
                          onTap: () => context.push('/stocktakes/${s['id']}'),
                          child: Row(children: [
                            Container(
                              width: 44,
                              height: 44,
                              decoration: BoxDecoration(
                                color: s['diffItems'] == 0 ? const Color(0xFFE8F5EC) : const Color(0xFFFFF4E5),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Icon(
                                s['diffItems'] == 0 ? Icons.check_circle_outline : Icons.published_with_changes_rounded,
                                color: s['diffItems'] == 0 ? const Color(0xFF2E9E5B) : const Color(0xFFB25E00),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(s['orderNo'], style: t.titleMedium),
                                const SizedBox(height: 2),
                                Text(
                                  '${_dt.format(DateTime.parse(s['createdAt']).toLocal())} · 盘 ${s['totalItems']} 项'
                                  '${s['diffItems'] == 0 ? ' · 账实相符' : ' · ${s['diffItems']} 项有出入'}',
                                  style: t.bodyMedium?.copyWith(fontSize: 12),
                                ),
                              ]),
                            ),
                            if (s['diffItems'] != 0)
                              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                                if (s['gainQty'] > 0) Text('盈 +${s['gainQty']}', style: const TextStyle(fontSize: 12, color: Color(0xFF2E9E5B), fontWeight: FontWeight.w600)),
                                if (s['lossQty'] > 0) Text('亏 -${s['lossQty']}', style: const TextStyle(fontSize: 12, color: AppColors.error, fontWeight: FontWeight.w600)),
                              ]),
                          ]),
                        ),
                      ),
                  ],
                ),
              ),
      ),
    );
  }
}

/// 盘点单详情
class StocktakeDetailScreen extends StatelessWidget {
  final int id;
  const StocktakeDetailScreen({super.key, required this.id});

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('盘点详情')),
      body: FutureBuilder(
        future: Api.I.get('/stocktakes/$id'),
        builder: (context, snap) {
          if (!snap.hasData) {
            return snap.hasError ? Center(child: Text('${snap.error}')) : const Center(child: CircularProgressIndicator());
          }
          final d = Map<String, dynamic>.from(snap.data as Map);
          final items = List<Map<String, dynamic>>.from(d['items']);
          final diffs = items.where((i) => i['diff'] != 0).toList();
          final sames = items.where((i) => i['diff'] == 0).toList();
          return ListView(
            padding: const EdgeInsets.fromLTRB(kPagePadding, 8, kPagePadding, 40),
            children: [
              SoftCard(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(d['orderNo'], style: t.headlineMedium),
                  const SizedBox(height: 4),
                  Text(
                    '${_dt.format(DateTime.parse(d['createdAt']).toLocal())} · ${d['operator']?['realName'] ?? '-'} 盘点'
                    '${(d['notes'] ?? '') != '' && d['notes'] != null ? '\n备注：${d['notes']}' : ''}',
                    style: t.bodyMedium?.copyWith(fontSize: 12, height: 1.5),
                  ),
                  const SizedBox(height: 10),
                  Row(children: [
                    _Stat(label: '实盘', value: '${d['totalItems']} 项'),
                    _Stat(label: '有出入', value: '${d['diffItems']} 项'),
                    _Stat(label: '盘盈', value: '+${d['gainQty']}', color: const Color(0xFF2E9E5B)),
                    _Stat(label: '盘亏', value: '-${d['lossQty']}', color: AppColors.error),
                  ]),
                ]),
              ),
              if (diffs.isNotEmpty) ...[
                const SizedBox(height: 16),
                Text('有出入（库存已按实盘调平）', style: t.titleMedium),
                const SizedBox(height: 8),
                SoftCard(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  child: Column(children: [for (final i in diffs) _ItemRow(item: i)]),
                ),
              ],
              if (sames.isNotEmpty) ...[
                const SizedBox(height: 16),
                Text('账实相符', style: t.titleMedium),
                const SizedBox(height: 8),
                SoftCard(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  child: Column(children: [for (final i in sames) _ItemRow(item: i)]),
                ),
              ],
            ],
          );
        },
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  final String label;
  final String value;
  final Color? color;
  const _Stat({required this.label, required this.value, this.color});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(children: [
        Text(value, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: color ?? AppColors.onSurface)),
        const SizedBox(height: 2),
        Text(label, style: const TextStyle(fontSize: 11, color: AppColors.onSurfaceVariant)),
      ]),
    );
  }
}

class _ItemRow extends StatelessWidget {
  final Map<String, dynamic> item;
  const _ItemRow({required this.item});

  @override
  Widget build(BuildContext context) {
    final diff = item['diff'] as int;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 9),
      child: Row(children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(item['productName'], style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
            if ((item['specText'] ?? '') != '' && item['specText'] != null)
              Text(item['specText'], style: const TextStyle(fontSize: 11, color: AppColors.onSurfaceVariant)),
          ]),
        ),
        Text('账面 ${item['systemQty']} → 实盘 ${item['actualQty']}', style: const TextStyle(fontSize: 12, color: AppColors.onSurfaceVariant)),
        const SizedBox(width: 10),
        SizedBox(
          width: 44,
          child: Text(
            diff == 0 ? '—' : (diff > 0 ? '+$diff' : '$diff'),
            textAlign: TextAlign.right,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: diff == 0 ? AppColors.onSurfaceVariant : (diff > 0 ? const Color(0xFF2E9E5B) : AppColors.error),
            ),
          ),
        ),
      ]),
    );
  }
}

/// 开始盘点：按品类过滤 → 逐项填实盘数（默认=账面数） → 差异确认 → 提交
class StocktakeCreateScreen extends ConsumerStatefulWidget {
  const StocktakeCreateScreen({super.key});

  @override
  ConsumerState<StocktakeCreateScreen> createState() => _StocktakeCreateScreenState();
}

class _StocktakeCreateScreenState extends ConsumerState<StocktakeCreateScreen> {
  int? _typeId;
  String _query = '';
  bool _loading = true;
  bool _submitting = false;
  List<Map<String, dynamic>> _rows = []; // {skuId, name, specText, systemQty, controller}

  bool _rowMatches(Map<String, dynamic> r) {
    final q = _query.trim().toLowerCase();
    if (q.isEmpty) return true;
    return (r['name'] as String).toLowerCase().contains(q) || (r['specText'] as String).toLowerCase().contains(q);
  }

  @override
  void initState() {
    super.initState();
    // 默认盘主营品类（只做一门生意时等同全部）
    _typeId = ref.read(mainTypeIdProvider);
    _loadInventory();
  }

  @override
  void dispose() {
    for (final r in _rows) {
      (r['controller'] as TextEditingController).dispose();
    }
    super.dispose();
  }

  Future<void> _loadInventory() async {
    setState(() => _loading = true);
    try {
      // 盘点必须拿全：只拉到 500 条却在单子上写「账实相符」，等于给老板一张假的合规凭证。
      // 逐页拉直到取完，取不全就明确报错，不允许静默截断。
      final list = <Map<String, dynamic>>[];
      var page = 1;
      var total = 0;
      while (true) {
        final d = await Api.I.get('/inventory', query: {
          'page': page,
          'pageSize': 200,
          if (_typeId != null) 'productTypeId': _typeId,
        });
        final chunk = List<Map<String, dynamic>>.from(d['list']);
        total = (d['pagination']?['total'] ?? chunk.length) as int;
        list.addAll(chunk);
        if (list.length >= total || chunk.isEmpty || page > 50) break;
        page++;
      }
      if (list.length < total) {
        throw Exception('只取到 $total 个规格里的 ${list.length} 个，盘点不能只盘一半。稍后重试或按品类分批盘');
      }
      for (final r in _rows) {
        (r['controller'] as TextEditingController).dispose();
      }
      _rows = [
        for (final i in list)
          {
            'skuId': i['sku']['id'],
            'name': i['sku']['product']['name'],
            'specText': i['sku']['specText'] ?? '',
            'systemQty': i['quantity'],
            'controller': TextEditingController(text: '${i['quantity']}'),
          }
      ];
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  int? _actualOf(Map<String, dynamic> r) {
    final txt = (r['controller'] as TextEditingController).text.trim();
    return int.tryParse(txt);
  }

  Future<void> _submit() async {
    // 空/非法输入按账面数处理（没动就是没出入）
    final items = <Map<String, dynamic>>[];
    final diffs = <Map<String, dynamic>>[];
    for (final r in _rows) {
      final actual = _actualOf(r) ?? r['systemQty'] as int;
      items.add({'skuId': r['skuId'], 'actualQty': actual});
      final diff = actual - (r['systemQty'] as int);
      if (diff != 0) diffs.add({...r, 'actual': actual, 'diff': diff});
    }
    if (items.isEmpty) return;

    // 差异确认：让用户看清楚哪些会被改库存
    final ok = await showModalBottomSheet<bool>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(diffs.isEmpty ? '账实相符' : '确认盘点结果', style: Theme.of(ctx).textTheme.headlineMedium),
            const SizedBox(height: 8),
            if (diffs.isEmpty)
              const Text('全部商品实盘数与账面一致，提交后仅留盘点记录，不改库存。', style: TextStyle(fontSize: 13, height: 1.5))
            else ...[
              Text('${diffs.length} 项有出入，提交后库存会按实盘数调平：', style: const TextStyle(fontSize: 13)),
              const SizedBox(height: 8),
              ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 260),
                child: ListView(shrinkWrap: true, children: [
                  for (final d in diffs)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 5),
                      child: Row(children: [
                        Expanded(child: Text('${d['name']}${d['specText'] != '' ? '（${d['specText']}）' : ''}', style: const TextStyle(fontSize: 13))),
                        Text('${d['systemQty']} → ${d['actual']}', style: const TextStyle(fontSize: 13, color: AppColors.onSurfaceVariant)),
                        const SizedBox(width: 8),
                        Text((d['diff'] as int) > 0 ? '+${d['diff']}' : '${d['diff']}',
                            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: (d['diff'] as int) > 0 ? const Color(0xFF2E9E5B) : AppColors.error)),
                      ]),
                    ),
                ]),
              ),
            ],
            const SizedBox(height: 16),
            Row(children: [
              Expanded(child: OutlinedButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('再改改'))),
              const SizedBox(width: 12),
              Expanded(child: FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('确认提交'))),
            ]),
          ]),
        ),
      ),
    );
    if (ok != true || !mounted) return;

    setState(() => _submitting = true);
    try {
      final d = await Api.I.post('/stocktakes', data: {
        if (_typeId != null) 'productTypeId': _typeId,
        'items': items,
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text('✓ ${d['orderNo']} 盘点完成${diffs.isEmpty ? '，账实相符' : '，${diffs.length} 项库存已调平'}')));
      context.pop();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final types = ref.watch(typesProvider).valueOrNull ?? [];
    final diffCount = _rows.where((r) => (_actualOf(r) ?? r['systemQty']) != r['systemQty']).length;
    return Scaffold(
      appBar: AppBar(title: const Text('开始盘点')),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
          child: FilledButton(
            onPressed: _submitting || _loading || _rows.isEmpty ? null : _submit,
            child: Text(_submitting ? '提交中…' : (diffCount == 0 ? '提交盘点（账实相符）' : '提交盘点（$diffCount 项有出入）')),
          ),
        ),
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(kPagePadding, 8, kPagePadding, 4),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(children: [
              ChoiceChip(
                label: const Text('全部'),
                selected: _typeId == null,
                onSelected: (_) {
                  setState(() => _typeId = null);
                  _loadInventory();
                },
              ),
              const SizedBox(width: 8),
              for (final tp in types) ...[
                ChoiceChip(
                  label: Text(tp.name),
                  selected: _typeId == tp.id,
                  onSelected: (_) {
                    setState(() => _typeId = tp.id);
                    _loadInventory();
                  },
                ),
                const SizedBox(width: 8),
              ],
            ]),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(kPagePadding, 6, kPagePadding, 0),
          child: TextField(
            onChanged: (v) => setState(() => _query = v),
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: '搜商品名 / 规格（只影响显示，不影响提交范围）',
              prefixIcon: const Icon(Icons.search_rounded, color: AppColors.onSurfaceVariant),
              isDense: true,
              filled: true,
              fillColor: Colors.white,
              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: kPagePadding, vertical: 4),
          child: Row(children: [
            const Icon(Icons.info_outline_rounded, size: 14, color: AppColors.onSurfaceVariant),
            const SizedBox(width: 6),
            Expanded(
              child: Text('每行填实际数出来的数量，没动过的默认按账面数（无出入）。',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontSize: 11)),
            ),
          ]),
        ),
        Expanded(
          child: Builder(builder: (context) {
            if (_loading) return const Center(child: CircularProgressIndicator());
            final visible = _rows.where(_rowMatches).toList();
            if (visible.isEmpty) {
              return Center(child: Text(_query.isEmpty ? '该品类下还没有商品' : '没有匹配「$_query」的商品'));
            }
            return ListView.builder(
                      padding: const EdgeInsets.fromLTRB(kPagePadding, 4, kPagePadding, 20),
                      itemCount: visible.length,
                      itemBuilder: (context, idx) {
                        final r = visible[idx];
                        final actual = _actualOf(r) ?? r['systemQty'] as int;
                        final diff = actual - (r['systemQty'] as int);
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: SoftCard(
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                            child: Row(children: [
                              Expanded(
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Text(r['name'], style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                                  Text(
                                    '${r['specText'] != '' ? '${r['specText']} · ' : ''}账面 ${r['systemQty']}',
                                    style: const TextStyle(fontSize: 11, color: AppColors.onSurfaceVariant),
                                  ),
                                ]),
                              ),
                              if (diff != 0)
                                Padding(
                                  padding: const EdgeInsets.only(right: 8),
                                  child: Text(diff > 0 ? '+$diff' : '$diff',
                                      style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: diff > 0 ? const Color(0xFF2E9E5B) : AppColors.error)),
                                ),
                              SizedBox(
                                width: 76,
                                child: TextField(
                                  controller: r['controller'] as TextEditingController,
                                  keyboardType: TextInputType.number,
                                  textAlign: TextAlign.center,
                                  onChanged: (_) => setState(() {}),
                                  decoration: InputDecoration(
                                    isDense: true,
                                    contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
                                    filled: true,
                                    fillColor: diff != 0 ? const Color(0xFFFFF4E5) : AppColors.surfaceContainer,
                                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                                  ),
                                ),
                              ),
                            ]),
                          ),
                        );
                      },
                    );
          }),
        ),
      ]),
    );
  }
}
