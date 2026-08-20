import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/api.dart';
import '../../core/local_notice.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';

/// 销售开单：选客户 → 加商品(多规格时选规格,自动带客户专属价) → 折扣/实收/结算账户 → 提交扣库存
class OrderCreateScreen extends ConsumerStatefulWidget {
  final int? initialCustomerId; // 从客户详情/换货桥进来直接锁定客户
  final int? duplicateFromId; // 再来一单：把那张单的商品和价格整个铺进购物车
  const OrderCreateScreen({super.key, this.initialCustomerId, this.duplicateFromId});

  @override
  ConsumerState<OrderCreateScreen> createState() => _OrderCreateScreenState();
}

class _CartItem {
  final Product product;
  final Sku sku;
  double quantity;
  double unitPrice;
  String priceSource; // customer | default
  _CartItem({required this.product, required this.sku, required this.unitPrice, required this.priceSource}) : quantity = 1;
}

const _settlementAccounts = ['现金', '微信', '支付宝', '银行卡', '挂账'];

/// 常买 chip 的返回载体
class _FrequentPick {
  final int skuId;
  const _FrequentPick(this.skuId);
}

/// 快建商品的哨兵值（商品选择器里选了"快速新建"）
final _kQuickCreate = Product(id: -1, code: '', name: '', productTypeId: -1);

class _OrderCreateScreenState extends ConsumerState<OrderCreateScreen> {
  Customer? _customer;
  final List<_CartItem> _cart = [];

  @override
  void initState() {
    super.initState();
    _prefill();
  }

  // ===== 开单草稿：正开着单来了个客人插队/误触返回，回来单子还在 =====
  static const _draftKey = 'sale_draft_v1';
  Timer? _draftTimer;
  bool _submitted = false; // 提交成功后熔断，防 dispose 把已提交的单又存回去

  @override
  void setState(VoidCallback fn) {
    super.setState(fn);
    // 所有购物车/客户变化统一在这里捕获，防抖落盘——不用在十几个变更点逐个插调用
    _draftTimer?.cancel();
    _draftTimer = Timer(const Duration(milliseconds: 500), _saveDraft);
  }

  @override
  void dispose() {
    _draftTimer?.cancel();
    _saveDraft(); // 退出页面瞬间兜底快照
    super.dispose();
  }

  Future<void> _saveDraft() async {
    if (_submitted) return;
    final sp = await SharedPreferences.getInstance();
    if (_cart.isEmpty) {
      await sp.remove(_draftKey);
      return;
    }
    await sp.setString(_draftKey, jsonEncode({
      'customerId': _customer?.id,
      'items': [
        for (final i in _cart) {'skuId': i.sku.id, 'qty': i.quantity, 'price': i.unitPrice, 'src': i.priceSource}
      ],
    }));
  }

  Future<void> _restoreDraft() async {
    final sp = await SharedPreferences.getInstance();
    final raw = sp.getString(_draftKey);
    if (raw == null) return;
    try {
      final d = jsonDecode(raw) as Map<String, dynamic>;
      final all = await ref.read(productsProvider(null).future);
      final restored = <_CartItem>[];
      for (final it in (d['items'] as List)) {
        for (final prod in all) {
          final sku = prod.skus.where((k) => k.id == it['skuId']).firstOrNull;
          if (sku != null) {
            restored.add(_CartItem(product: prod, sku: sku, unitPrice: (it['price'] as num).toDouble(), priceSource: (it['src'] ?? 'default') as String)
              ..quantity = (it['qty'] as num).toDouble());
            break;
          }
        }
      }
      if (restored.isEmpty || !mounted) return;
      Customer? cust;
      if (d['customerId'] != null) {
        final customers = await ref.read(customersProvider.future);
        cust = customers.where((c) => c.id == d['customerId']).firstOrNull;
      }
      if (!mounted) return;
      setState(() {
        _cart.addAll(restored);
        _customer ??= cust;
      });
      _toast('上次没提交的单已恢复（${restored.length} 项），不要可清空购物车');
    } catch (_) {
      await sp.remove(_draftKey);
    }
  }

  /// 预填：锁客户 / 复制上一单（熟客月月拿一样的货，重敲一遍是浪费生命）
  Future<void> _prefill() async {
    // 无预填参数的普通进入 → 恢复上次未提交的草稿（有参数时以参数为准，不混草稿）
    if (widget.initialCustomerId == null && widget.duplicateFromId == null) {
      await _restoreDraft();
      return;
    }
    if (widget.initialCustomerId != null) {
      final customers = await ref.read(customersProvider.future);
      final hit = customers.where((c) => c.id == widget.initialCustomerId).firstOrNull;
      if (hit != null && mounted) setState(() => _customer = hit);
    }
    if (widget.duplicateFromId != null) {
      try {
        final o = await Api.I.get('/orders/${widget.duplicateFromId}');
        final all = await ref.read(productsProvider(null).future);
        if (!mounted) return;
        // 客户跟着原单走（除非已被 initialCustomerId 指定）
        if (_customer == null && o['customer'] != null && o['customer']['name'] != '散客') {
          final customers = await ref.read(customersProvider.future);
          final hit = customers.where((c) => c.id == o['customerId']).firstOrNull;
          if (hit != null) _customer = hit;
        }
        var missed = 0;
        for (final it in (o['items'] as List)) {
          Product? prod;
          Sku? sku;
          for (final p in all) {
            final k = p.skus.where((x) => x.id == it['skuId']).firstOrNull;
            if (k != null) {
              prod = p;
              sku = k;
              break;
            }
          }
          if (prod == null || sku == null) {
            missed++;
            continue; // 商品被删了就跳过，别复制个幽灵进来
          }
          _cart.add(_CartItem(product: prod, sku: sku, unitPrice: (it['unitPrice'] as num).toDouble(), priceSource: 'last')
            ..quantity = (it['quantity'] as num).toDouble());
        }
        if (mounted) {
          setState(() {});
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
              content: Text('✓ 已按 ${o['orderNo']} 铺好 ${_cart.length} 项${missed > 0 ? '（$missed 项商品已删除，跳过）' : ''}，改改数量就能开')));
        }
      } catch (e) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('复制订单失败：$e')));
      }
    }
  }
  final _discountRate = TextEditingController(); // 如 95 = 95折
  final _paid = TextEditingController();
  String? _settlement;
  bool _saving = false;

  double get _total => _cart.fold(0.0, (s, i) => s + i.quantity * i.unitPrice);
  double get _discountAmount {
    final rate = double.tryParse(_discountRate.text);
    if (rate == null || rate <= 0 || rate >= 100) return 0;
    return double.parse((_total * (100 - rate) / 100).toStringAsFixed(2));
  }

  double get _actual => double.parse((_total - _discountAmount).toStringAsFixed(2));

  /// 弹窗里直接建客户：站在柜台前才想起来这是个新客，不该被赶去「我的→客户管理」
  Future<Customer?> _createCustomerInline(BuildContext ctx) async {
    final name = TextEditingController();
    final phone = TextEditingController();
    final ok = await showDialog<bool>(
      context: ctx,
      builder: (dctx) => AlertDialog(
        title: const Text('新客户'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: name, autofocus: true, decoration: const InputDecoration(labelText: '客户名称')),
          const SizedBox(height: 10),
          TextField(controller: phone, decoration: const InputDecoration(labelText: '电话（选填）')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dctx, false), child: const Text('取消')),
          TextButton(onPressed: () => Navigator.pop(dctx, true), child: const Text('保存')),
        ],
      ),
    );
    if (ok != true || name.text.trim().isEmpty) return null;
    try {
      final data = await Api.I.post('/customers', data: {
        'name': name.text.trim(),
        if (phone.text.trim().isNotEmpty) 'phone': phone.text.trim(),
      });
      ref.invalidate(customersProvider);
      return Customer.fromJson(data);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      return null;
    }
  }

  Future<void> _pickCustomer() async {
    // 先弹窗，再在弹窗里加载客户列表。
    // 以前是「先 await 客户列表、成功了才弹窗」，两个后果：网一慢点了就像没反应，
    // 接口一报错更是彻底没动静（这段没有 try/catch）——用户会以为压根没这功能。
    // 现在无论网络怎么样，点一下必定弹窗，散客和新建客户永远可用。
    // null = 散客（不是"没选"，是明确的"零售不记名"）
    final picked = await showModalBottomSheet<Object?>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => _CustomerPickerSheet(selectedId: _customer?.id),
    );

    if (picked == null) return;
    Customer? target;
    if (picked == 'walkin') {
      setState(() => _customer = null);
      return;
    } else if (picked == 'new') {
      if (!mounted) return;
      target = await _createCustomerInline(context);
      if (target == null) return;
    } else if (picked is Customer) {
      target = picked;
    }
    if (target == null) return;

    setState(() => _customer = target);
    // 重新解析购物车价格（客户专属价按 SKU）
    for (final item in _cart) {
      try {
        final data = await Api.I.get('/pricing/resolve', query: {'customerId': target.id, 'skuId': item.sku.id});
        if (!mounted) return;
        setState(() {
          item.unitPrice = (data['price'] as num).toDouble();
          item.priceSource = data['source'];
        });
      } catch (_) {
        // 单行价格解析失败不该中断整个流程：保留原价，用户可以点行手动改
      }
    }
  }

  Future<void> _addProduct() async {
    final customerTypeId = _customer?.productTypeId;
    // 选货弹窗离不开商品列表，所以只能先取数。但取数失败必须让用户看见——
    // 以前这里没有 try/catch，一失败就是「点了添加商品毫无反应」，跟按钮坏了没区别。
    final List<Product> all;
    final List<ProductType> types;
    try {
      all = await ref.read(productsProvider(null).future);
      types = await ref.read(typesProvider.future);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: const Text('商品列表没加载出来，检查下网络'),
        action: SnackBarAction(
          label: '重试',
          onPressed: () {
            ref.invalidate(productsProvider(null));
            ref.invalidate(typesProvider);
            _addProduct();
          },
        ),
      ));
      return;
    }
    final mainTypeId = ref.read(mainTypeIdProvider);
    if (!mounted) return;
    // 弹窗内的筛选状态必须放在 builder **外面**。
    // 放里面的话，键盘弹起来（viewInsets 变化）会让 showModalBottomSheet 重跑 builder，
    // 这几个变量当场被重置回初值——用户看到的是"输入框里有字，列表却没过滤"，
    // 而且是打字打到一半才发生，极难自查。2026-08-16 被集成测试逮到。
    bool onlyCustomerType = customerTypeId != null;
    String query = '';
    // 客户没定主营品类时，默认落在店铺主营品类
    int? typeFilter = customerTypeId == null ? mainTypeId : null;
    final picked = await showModalBottomSheet<Object>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setModal) {
            var products = onlyCustomerType ? all.where((p) => p.productTypeId == customerTypeId).toList() : all;
            if (typeFilter != null) products = products.where((p) => p.productTypeId == typeFilter).toList();
            products = products.where((p) => p.matches(query)).toList();
            return SafeArea(
              child: SizedBox(
                height: MediaQuery.of(ctx).size.height * 0.8,
                child: Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
                      child: Column(children: [
                        Row(children: [
                          Expanded(child: Text('选择商品', style: Theme.of(ctx).textTheme.headlineMedium)),
                          if (customerTypeId != null)
                            TextButton(
                              onPressed: () => setModal(() => onlyCustomerType = !onlyCustomerType),
                              child: Text(onlyCustomerType ? '显示全部品类' : '只看主营品类'),
                            ),
                        ]),
                        TextField(
                          autofocus: false,
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
                        // 未按客户主营过滤时提供品类 chips
                        if (!onlyCustomerType && types.isNotEmpty)
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
                        if (customerTypeId != null && onlyCustomerType)
                          Padding(
                            padding: const EdgeInsets.only(top: 6),
                            child: Align(
                              alignment: Alignment.centerLeft,
                              child: Text('已按「${_customer!.name}」的主营品类过滤', style: Theme.of(ctx).textTheme.bodyMedium?.copyWith(fontSize: 12)),
                            ),
                          ),
                      ]),
                    ),
                    Expanded(
                      child: ListView(
                        padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
                        children: [
                          // TA 常买：老客户十次有八次买同样的货，一点入车
                          if (_customer != null)
                            FutureBuilder(
                              future: Api.I.get('/customers/${_customer!.id}/frequent'),
                              builder: (c2, snap) {
                                final list = (snap.data as List?) ?? const [];
                                if (list.isEmpty) return const SizedBox.shrink();
                                return Padding(
                                  padding: const EdgeInsets.only(bottom: 8),
                                  child: Wrap(spacing: 6, runSpacing: 6, children: [
                                    for (final f in list.take(6))
                                      ActionChip(
                                        avatar: const Icon(Icons.history_rounded, size: 14, color: AppColors.primary),
                                        label: Text('${f['productName']}${(f['specText'] ?? '') != '' ? ' ${f['specText']}' : ''}',
                                            style: const TextStyle(fontSize: 12)),
                                        onPressed: () => Navigator.pop(ctx, _FrequentPick(f['skuId'] as int)),
                                      ),
                                  ]),
                                );
                              },
                            ),
                          // 开单即建品：卖到没建档的货，当场快建（智慧记验证过的最聪明设计）
                          ListTile(
                            leading: const Icon(Icons.add_circle_outline, color: AppColors.primary),
                            title: const Text('找不到？快速新建商品', style: TextStyle(color: AppColors.primary, fontWeight: FontWeight.w600)),
                            onTap: () => Navigator.pop(ctx, _kQuickCreate),
                          ),
                          const Divider(height: 1),
                          if (products.isEmpty)
                            Padding(
                              padding: const EdgeInsets.all(20),
                              child: Text(query.isEmpty ? '该品类下还没有商品' : '没有匹配「$query」的商品，可以点上面快速新建'),
                            ),
                          for (final p in products)
                            ListTile(
                              leading: ProductThumb(imageUrl: p.imageUrl, name: p.name),
                              title: Text(p.name),
                              subtitle: Text(p.hasSpecs
                                  ? '${p.skus.length}个规格 · 总库存 ${p.totalStock}'
                                  : '¥${p.defaultSku?.price ?? p.defaultPrice} / ${p.unit} · 库存 ${p.totalStock}'),
                              trailing: p.hasSpecs ? const Icon(Icons.chevron_right_rounded) : null,
                              onTap: () => Navigator.pop(ctx, p),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
    if (picked == null || !mounted) return;

    // 常买 chip：按 skuId 直接入车
    if (picked is _FrequentPick) {
      for (final p in all) {
        final k = p.skus.where((x) => x.id == picked.skuId).firstOrNull;
        if (k != null) {
          await _addSkuToCart(p, k, 1);
          return;
        }
      }
      return;
    }
    if (picked is! Product) return;

    // 快速新建商品 → 三填（名称/售价/品类）→ 建好直接入车
    if (identical(picked, _kQuickCreate)) {
      final created = await _quickCreateProduct();
      if (created == null || !mounted) return;
      final sku0 = created.defaultSku;
      if (sku0 == null) return;
      double price0 = sku0.price;
      String source0 = 'default';
      if (_customer != null) {
        final data = await Api.I.get('/pricing/resolve', query: {'customerId': _customer!.id, 'skuId': sku0.id});
        price0 = (data['price'] as num).toDouble();
        source0 = data['source'];
      }
      setState(() => _cart.add(_CartItem(product: created, sku: sku0, unitPrice: price0, priceSource: source0)));
      return;
    }

    // 多规格 → 一次多选带数量（"黑色M两件、白色L一件"不该点三轮弹窗）；单规格直接用默认
    if (picked.skus.length > 1) {
      final qtys = {for (final k in picked.skus) k.id: 0.0};
      final ok = await showModalBottomSheet<bool>(
        context: context,
        isScrollControlled: true,
        builder: (ctx) => StatefulBuilder(
          builder: (ctx, setModal) {
            final chosen = qtys.values.where((v) => v > 0).length;
            return SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${picked.name} · 选规格', style: Theme.of(ctx).textTheme.headlineMedium),
                  const SizedBox(height: 12),
                  ConstrainedBox(
                    constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * 0.5),
                    child: ListView(shrinkWrap: true, children: [
                      for (final k in picked.skus)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 4),
                          child: Row(children: [
                            Expanded(
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(k.displayName, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                                Text('¥${k.price} · 库存 ${fmtQty(k.stock)}',
                                    style: const TextStyle(fontSize: 11, color: AppColors.onSurfaceVariant)),
                              ]),
                            ),
                            IconButton(
                              icon: const Icon(Icons.remove_circle_outline, size: 22, color: AppColors.onSurfaceVariant),
                              onPressed: qtys[k.id]! > 0 ? () => setModal(() => qtys[k.id] = qtys[k.id]! - 1) : null,
                            ),
                            SizedBox(width: 28, child: Text(fmtQty(qtys[k.id]!), textAlign: TextAlign.center, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700))),
                            IconButton(
                              icon: const Icon(Icons.add_circle_outline, size: 22, color: AppColors.primary),
                              onPressed: () => setModal(() => qtys[k.id] = qtys[k.id]! + 1),
                            ),
                          ]),
                        ),
                    ]),
                  ),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: chosen > 0 ? () => Navigator.pop(ctx, true) : null,
                      child: Text(chosen > 0 ? '加入 $chosen 个规格' : '点＋选数量'),
                    ),
                  ),
                ]),
              ),
            );
          },
        ),
      );
      if (ok != true) return;
      for (final k in picked.skus) {
        final q = qtys[k.id]!;
        if (q <= 0) continue;
        await _addSkuToCart(picked, k, q);
      }
      return;
    }
    final sku = picked.defaultSku;
    if (sku == null) return;
    await _addSkuToCart(picked, sku, 1);
  }

  /// 入车公共路径：已有行加量，新行解析客户专属价
  Future<void> _addSkuToCart(Product product, Sku sku, double qty) async {
    final existing = _cart.where((i) => i.sku.id == sku.id).firstOrNull;
    if (existing != null) {
      setState(() => existing.quantity += qty);
      return;
    }
    double price = sku.price;
    String source = 'default';
    if (_customer != null) {
      try {
        final data = await Api.I.get('/pricing/resolve', query: {'customerId': _customer!.id, 'skuId': sku.id});
        price = (data['price'] as num).toDouble();
        source = data['source'];
      } catch (_) {/* 网络抖动就用标价，不拦着开单 */}
    }
    if (!mounted) return;
    setState(() => _cart.add(_CartItem(product: product, sku: sku, unitPrice: price, priceSource: source)..quantity = qty));
  }

  /// 快速新建商品：名称 + 售价 + 品类，三填入车（有初始库存需求去商品页补）
  Future<Product?> _quickCreateProduct() async {
    final types = await ref.read(typesProvider.future);
    if (!mounted) return null;
    final name = TextEditingController();
    final price = TextEditingController();
    final stock = TextEditingController();
    int? typeId = types.firstOrNull?.id;

    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModal) => Padding(
          padding: EdgeInsets.fromLTRB(24, 24, 24, MediaQuery.of(ctx).viewInsets.bottom + 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('快速新建商品', style: Theme.of(ctx).textTheme.headlineMedium),
              const SizedBox(height: 4),
              Text('先建档开单，详细信息之后可在商品页补', style: Theme.of(ctx).textTheme.bodyMedium),
              const SizedBox(height: 16),
              TextField(controller: name, autofocus: true, decoration: const InputDecoration(labelText: '商品名称 *')),
              const SizedBox(height: 12),
              Row(children: [
                Expanded(child: TextField(controller: price, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: '售价 ¥ *'))),
                const SizedBox(width: 12),
                Expanded(child: TextField(controller: stock, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: '现有库存 *'))),
              ]),
              const SizedBox(height: 12),
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final t in types)
                  ChoiceChip(label: Text(t.name), selected: typeId == t.id, onSelected: (_) => setModal(() => typeId = t.id)),
              ]),
              const SizedBox(height: 16),
              FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('创建并加入订单')),
            ],
          ),
        ),
      ),
    );
    if (ok != true) return null;
    if (name.text.trim().isEmpty || typeId == null) {
      _toast('名称和品类必填');
      return null;
    }
    final qty = int.tryParse(stock.text) ?? 0;
    try {
      final data = await Api.I.post('/products', data: {
        'name': name.text.trim(),
        'productTypeId': typeId,
        'defaultPrice': double.tryParse(price.text) ?? 0,
        'customFields': <String, dynamic>{},
        'skus': [
          {'specValues': <String, dynamic>{}, 'price': double.tryParse(price.text) ?? 0, 'initQuantity': qty}
        ],
      });
      invalidateProducts(ref);
      return Product.fromJson(data);
    } catch (e) {
      _toast('$e');
      return null;
    }
  }

  /// 扫码加货：扫条码 → 命中规格 → 直接入车（客户专属价照常解析）
  Future<void> _scanAdd() async {
    final code = await context.push<String>('/scan-code');
    if (code == null || code.isEmpty || !mounted) return;
    try {
      final data = await Api.I.post('/products/lookup', data: {'code': code});
      final product = Product.fromJson(data);
      final sku = data['matchedSku'] == null ? product.defaultSku : Sku.fromJson(data['matchedSku']);
      if (sku == null) return _toast('该商品没有可用规格');
      final existing = _cart.where((i) => i.sku.id == sku.id).firstOrNull;
      if (existing != null) {
        setState(() => existing.quantity++);
        _toast('${product.name} 数量+1');
        return;
      }
      double price = sku.price;
      String source = 'default';
      if (_customer != null) {
        final r = await Api.I.get('/pricing/resolve', query: {'customerId': _customer!.id, 'skuId': sku.id});
        price = (r['price'] as num).toDouble();
        source = r['source'];
      }
      setState(() => _cart.add(_CartItem(product: product, sku: sku, unitPrice: price, priceSource: source)));
      _toast('✓ 已加入 ${product.name}${sku.specText.isNotEmpty ? ' ${sku.specText}' : ''}');
    } catch (e) {
      _toast('$e');
    }
  }

  /// 改价改量：批发谈价是每一单都发生的事。改完价可一键沉淀为该客户的专属价，
  /// 价格体系在开单过程中自然长出来，不用去后台单独维护。
  Future<void> _editCartLine(_CartItem item, int index) async {
    final qtyCtl = TextEditingController(text: fmtQty(item.quantity));
    final priceCtl = TextEditingController(text: '${item.unitPrice}');
    var saveAsCustomerPrice = false;
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModal) => Padding(
          padding: EdgeInsets.fromLTRB(24, 24, 24, MediaQuery.of(ctx).viewInsets.bottom + 24),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(item.sku.specText.isEmpty ? item.product.name : '${item.product.name} ${item.sku.specText}',
                style: Theme.of(ctx).textTheme.headlineMedium),
            const SizedBox(height: 14),
            Row(children: [
              Expanded(
                child: TextField(
                  controller: qtyCtl,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(labelText: '数量（${item.product.unit}）'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: priceCtl,
                  autofocus: true,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: '单价 ¥'),
                ),
              ),
            ]),
            if (_customer != null)
              CheckboxListTile(
                value: saveAsCustomerPrice,
                onChanged: (v) => setModal(() => saveAsCustomerPrice = v ?? false),
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                title: Text('记为「${_customer!.name}」的专属价，下次自动用', style: const TextStyle(fontSize: 13)),
              ),
            const SizedBox(height: 8),
            Row(children: [
              TextButton(
                onPressed: () {
                  Navigator.pop(ctx, false);
                  setState(() => _cart.removeAt(index));
                },
                child: const Text('删除这行', style: TextStyle(color: AppColors.error)),
              ),
              const Spacer(),
              // 主题给按钮设了 minimumSize 宽=∞，Row 里裸放会每帧抛"无限宽"布局断言（表现就是页面卡死）
              FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                style: FilledButton.styleFrom(minimumSize: const Size(96, 48)),
                child: const Text('确定'),
              ),
            ]),
          ]),
        ),
      ),
    );
    if (ok != true) return;
    final q = double.tryParse(qtyCtl.text);
    final pr = double.tryParse(priceCtl.text);
    if (q == null || q <= 0 || pr == null || pr < 0) return _toast('数量或单价没填对');
    setState(() {
      item.quantity = q;
      item.unitPrice = pr;
    });
    if (saveAsCustomerPrice && _customer != null) {
      try {
        await Api.I.post('/pricing', data: {'productId': item.product.id, 'skuId': item.sku.id, 'customerId': _customer!.id, 'price': pr});
        setState(() => item.priceSource = 'customer');
        _toast('✓ 已记为 ${_customer!.name} 的专属价');
      } catch (e) {
        _toast('专属价保存失败：$e');
      }
    }
  }

  Future<void> _submit() async {
    // 不选客户 = 散客，后端兜底。不能因为"没建客户档案"就开不出单
    if (_cart.isEmpty) return _toast('还没加商品');
    final rate = double.tryParse(_discountRate.text);
    // 折扣输进 9.5 想表达 95 折的人不少——9.5 折等于打掉九成，先确认再放行
    if (rate != null && rate > 0 && rate < 50) {
      final go = await showDialog<bool>(
        context: context,
        builder: (dctx) => AlertDialog(
          title: Text('折扣是 $rate 折？'),
          content: Text('$rate 折 = 客人只付 $rate%（原价 ¥${_total.toStringAsFixed(2)} → ¥${(_total * rate / 100).toStringAsFixed(2)}）。\n如果想打 9${rate == rate.roundToDouble() ? rate.toInt() : rate} 折，应该填 9$rate。'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dctx, false), child: const Text('回去改')),
            TextButton(onPressed: () => Navigator.pop(dctx, true), child: Text('就是 $rate 折')),
          ],
        ),
      );
      if (go != true) return;
    }
    double? paid = double.tryParse(_paid.text);
    double? extraDiscount;
    // 实收<应收 且没选挂账：到底是抹零还是欠款？不问清楚会生出一堆"永远还不掉的3块钱"
    final diff = paid == null ? 0.0 : double.parse((_actual - paid).toStringAsFixed(2));
    if (paid != null && diff > 0 && _settlement != '挂账' && mounted) {
      final choice = await showDialog<String>(
        context: context,
        builder: (dctx) => AlertDialog(
          title: Text('少收的 ¥${diff.toStringAsFixed(2)} 怎么算？'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dctx, 'discount'), child: const Text('抹零（不再收了）')),
            TextButton(onPressed: () => Navigator.pop(dctx, 'owe'), child: const Text('挂账（以后要收）')),
          ],
        ),
      );
      if (choice == null) return;
      if (choice == 'discount') {
        // 抹零 = 折扣金额，应收降到实收，这单直接结清
        extraDiscount = double.parse((_discountAmount + diff).toStringAsFixed(2));
      }
    }
    setState(() => _saving = true);
    try {
      final res = await Api.I.post('/orders', data: {
        if (_customer != null) 'customerId': _customer!.id,
        if (extraDiscount != null)
          'discountAmount': extraDiscount // 抹零并入折扣金额（金额优先于折扣率）
        else if (rate != null && rate > 0 && rate < 100)
          'discountRate': rate,
        if (paid != null) 'paidAmount': paid,
        if (_settlement != null) 'settlementAccount': _settlement,
        'items': [
          for (final i in _cart) {'skuId': i.sku.id, 'quantity': i.quantity, 'unitPrice': i.unitPrice}
        ],
      });
      ref.invalidate(ordersProvider);
      invalidateProducts(ref);
      ref.invalidate(overviewProvider);
      if (mounted) {
        // 卖成负库存要说清楚是哪个，否则老板不知道该补录什么
        final neg = List<String>.from(res['negativeStock'] ?? []);
        _submitted = true; // 熔断草稿：dispose 不再把已提交的单存回去
        _draftTimer?.cancel();
        SharedPreferences.getInstance().then((sp) => sp.remove(_draftKey));
        HapticFeedback.mediumImpact(); // 收银的"叮"感
        _toast(neg.isEmpty ? '✓ 开单成功，库存已扣减' : '✓ 开单成功。${neg.join("、")} 已成负库存，记得补录进货');
        // 留存钩子：开单成功的高光时刻，一次性引导开通收摊提醒（终生只弹一次，拒绝不再烦）
        await _maybeAskDailyNotice();
        if (mounted && context.canPop()) context.pop();
      }
    } catch (e) {
      _toast('$e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _toast(String msg) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  Future<void> _maybeAskDailyNotice() async {
    if (await LocalNotice.I.prompted || await LocalNotice.I.enabled) return;
    await LocalNotice.I.markPrompted();
    if (!mounted) return;
    final yes = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('要每天提醒你收摊记账吗？'),
        content: const Text('每天收摊时间（默认 21:00）提醒一声，账目不攒堆。提醒由手机本地发出，随时可在 通知 → 提醒设置 里关。'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('以后再说')),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(96, 44)), // 按钮进 Row 必须有限宽
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('好，提醒我'),
          ),
        ],
      ),
    );
    if (yes == true) {
      final ok = await LocalNotice.I.setEnabled(true);
      _toast(ok ? '✓ 已开启，每天 21:00 提醒（通知页可改时间）' : '通知权限没开，去 系统设置 → 智存 → 通知 里打开');
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final paidValue = double.tryParse(_paid.text);
    final unpaid = paidValue == null ? 0.0 : double.parse((_actual - paidValue).toStringAsFixed(2));

    return Scaffold(
      appBar: AppBar(title: const Text('销售开单')),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
          child: Row(children: [
            Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              Text(_discountAmount > 0 ? '折后应收' : '合计', style: t.bodyMedium?.copyWith(fontSize: 12)),
              Text('¥${_actual.toStringAsFixed(2)}',
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: AppColors.primary)),
            ]),
            const SizedBox(width: 20),
            Expanded(
              child: FilledButton(onPressed: _saving ? null : _submit, child: Text(_saving ? '提交中…' : '提交订单')),
            ),
          ]),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(kPagePadding, 8, kPagePadding, 40),
        children: [
          SoftCard(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
            onTap: _pickCustomer,
            child: Row(children: [
              const Icon(Icons.person_outline_rounded, color: AppColors.primary),
              const SizedBox(width: 10),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(_customer?.name ?? '散客（不记名）', style: t.titleMedium),
                  if (_customer == null)
                    Text('点这里可以选老客户或新建', style: t.bodyMedium?.copyWith(fontSize: 12)),
                ]),
              ),
              const Icon(Icons.chevron_right_rounded, color: AppColors.onSurfaceVariant),
            ]),
          ),
          const SizedBox(height: 16),
          for (final (i, item) in _cart.indexed)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: SoftCard(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                onTap: () => _editCartLine(item, i), // 点行改价改量（谈价是常态，别逼人删了重加）
                child: Row(children: [
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(
                        item.sku.specText.isEmpty ? item.product.name : '${item.product.name} ${item.sku.specText}',
                        style: t.titleMedium,
                      ),
                      const SizedBox(height: 2),
                      Row(children: [
                        Text('¥${item.unitPrice} / ${item.product.unit}', style: t.bodyMedium?.copyWith(fontSize: 12)),
                        if (item.priceSource == 'customer')
                          const Padding(
                            padding: EdgeInsets.only(left: 6),
                            child: Text('专属价', style: TextStyle(fontSize: 11, color: AppColors.primary, fontWeight: FontWeight.w600)),
                          ),
                        const Padding(
                          padding: EdgeInsets.only(left: 6),
                          child: Icon(Icons.edit_rounded, size: 12, color: AppColors.onSurfaceVariant),
                        ),
                      ]),
                    ]),
                  ),
                  IconButton(
                    icon: const Icon(Icons.remove_circle_outline, size: 22),
                    onPressed: () => setState(() {
                      if (item.quantity > 1) {
                        item.quantity = (item.quantity - 1).clamp(0.001, double.infinity);
                      } else {
                        _cart.removeAt(i);
                      }
                    }),
                  ),
                  Text(fmtQty(item.quantity), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                  IconButton(icon: const Icon(Icons.add_circle_outline, size: 22), onPressed: () => setState(() => item.quantity++)),
                ]),
              ),
            ),
          Row(children: [
            // FittedBox：系统字号调大时文字缩小而不是换行，两个按钮高度不会一高一低
            Expanded(
              child: OutlinedButton.icon(
                onPressed: _addProduct,
                icon: const Icon(Icons.add),
                label: const FittedBox(fit: BoxFit.scaleDown, child: Text('添加商品', maxLines: 1)),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: _scanAdd,
                icon: const Icon(Icons.qr_code_scanner_rounded, size: 18),
                label: const FittedBox(fit: BoxFit.scaleDown, child: Text('扫码加货', maxLines: 1)),
              ),
            ),
          ]),
          // ===== 结算区：折扣 / 实收 / 结算账户 =====
          if (_cart.isNotEmpty) ...[
            const SizedBox(height: 20),
            Text('结算', style: t.titleMedium),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(
                child: TextField(
                  controller: _discountRate,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: '折扣（如95=95折）'),
                  onChanged: (_) => setState(() {}),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: _paid,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  // 标签只留字段名，动态默认值放 hint——否则浮起来的标签又长又跳
                  decoration: InputDecoration(labelText: '实收 ¥', hintText: '默认 ${_actual.toStringAsFixed(2)}'),
                  onChanged: (_) => setState(() {}),
                ),
              ),
            ]),
            if (_discountAmount > 0)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text('原价 ¥${_total.toStringAsFixed(2)} − 折扣 ¥${_discountAmount.toStringAsFixed(2)}', style: t.bodyMedium?.copyWith(fontSize: 12)),
              ),
            if (paidValue != null && unpaid > 0)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text('挂账 ¥${unpaid.toStringAsFixed(2)}', style: t.bodyMedium?.copyWith(fontSize: 12, color: AppColors.warning)),
              ),
            const SizedBox(height: 12),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final acc in _settlementAccounts)
                ChoiceChip(
                  label: Text(acc),
                  selected: _settlement == acc,
                  onSelected: (_) => setState(() => _settlement = _settlement == acc ? null : acc),
                ),
            ]),
          ],
        ],
      ),
    );
  }
}

/// 客户选择弹窗：立刻弹出，客户列表在弹窗里异步加载。
///
/// 关键约束：「散客」和「新建客户」必须在列表加载完成之前就能点。
/// 开单是柜台前的动作，网卡了不能把人堵在这儿——散客本来就不需要任何数据，
/// 新建客户也只需要一个输入框。列表加载失败给明确提示 + 重试，绝不静默。
class _CustomerPickerSheet extends ConsumerStatefulWidget {
  final int? selectedId; // 当前已选客户，在列表里高亮出来
  const _CustomerPickerSheet({this.selectedId});

  @override
  ConsumerState<_CustomerPickerSheet> createState() => _CustomerPickerSheetState();
}

class _CustomerPickerSheetState extends ConsumerState<_CustomerPickerSheet> {
  List<Customer>? _customers;
  Object? _error;
  String _q = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _error = null;
      _customers = null;
    });
    try {
      final list = await ref.read(customersProvider.future);
      if (mounted) setState(() => _customers = list);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final all = _customers ?? const <Customer>[];
    final list = _q.trim().isEmpty
        ? all
        : all.where((c) => c.name.contains(_q.trim()) || (c.phone ?? '').contains(_q.trim())).toList();

    return SafeArea(
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.7,
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
            child: Column(children: [
              Align(alignment: Alignment.centerLeft, child: Text('卖给谁？', style: Theme.of(context).textTheme.headlineMedium)),
              const SizedBox(height: 10),
              if (all.length > 6)
                TextField(
                  onChanged: (v) => setState(() => _q = v),
                  decoration: InputDecoration(
                    hintText: '搜客户名 / 电话',
                    prefixIcon: const Icon(Icons.search_rounded, color: AppColors.onSurfaceVariant),
                    isDense: true,
                    filled: true,
                    fillColor: AppColors.surfaceContainer,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
                  ),
                ),
            ]),
          ),
          Expanded(
            child: ListView(padding: const EdgeInsets.fromLTRB(20, 4, 20, 20), children: [
              // 这两条不依赖任何网络数据，永远第一时间可点
              ListTile(
                leading: const Icon(Icons.person_outline_rounded, color: AppColors.primary),
                title: const Text('散客（不记名）', style: TextStyle(fontWeight: FontWeight.w600)),
                subtitle: const Text('一手交钱一手交货，不用建档案', style: TextStyle(fontSize: 12)),
                onTap: () => Navigator.pop(context, 'walkin'),
              ),
              ListTile(
                leading: const Icon(Icons.person_add_alt_1_rounded, color: AppColors.primary),
                title: const Text('新建客户', style: TextStyle(color: AppColors.primary, fontWeight: FontWeight.w600)),
                onTap: () => Navigator.pop(context, 'new'),
              ),
              const Divider(height: 1),
              if (_customers == null && _error == null)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 28),
                  child: Center(child: CircularProgressIndicator()),
                )
              else if (_error != null)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 24),
                  child: Column(children: [
                    const Icon(Icons.cloud_off_rounded, color: AppColors.outlineVariant, size: 32),
                    const SizedBox(height: 8),
                    const Text('老客户列表没加载出来', style: TextStyle(fontWeight: FontWeight.w600)),
                    const SizedBox(height: 4),
                    const Text('可以先按散客开单，或直接新建客户', style: TextStyle(fontSize: 12)),
                    const SizedBox(height: 10),
                    OutlinedButton.icon(
                      onPressed: _load,
                      icon: const Icon(Icons.refresh_rounded, size: 16),
                      label: const Text('重试'),
                    ),
                  ]),
                )
              else ...[
                if (list.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(4, 14, 4, 6),
                    child: Text('老客户 · ${list.length}',
                        style: Theme.of(context).textTheme.labelMedium?.copyWith(color: AppColors.onSurfaceVariant)),
                  ),
                for (var i = 0; i < list.length; i++) ...[
                  if (i > 0) const Divider(height: 1, indent: 56),
                  _customerRow(list[i]),
                ],
                if (list.isEmpty && all.isNotEmpty)
                  const Padding(padding: EdgeInsets.all(20), child: Text('没有匹配的客户')),
                if (all.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 24),
                    child: Text('还没有老客户档案，点上面「新建客户」建第一个', style: TextStyle(fontSize: 12)),
                  ),
              ],
            ]),
          ),
        ]),
      ),
    );
  }

  /// 单个客户行：首字头像 + 名字 + 电话，右边挂欠款。
  /// 欠款放右边是因为开单前老板最先想知道的就是"这人还欠我多少"——
  /// 挂着账还继续赊，是批发户最容易吃亏的地方。
  Widget _customerRow(Customer c) {
    final selected = c.id == widget.selectedId;
    final owed = c.owed;
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
      leading: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: selected ? AppColors.primary : AppColors.primaryFixed,
          borderRadius: BorderRadius.circular(12),
        ),
        alignment: Alignment.center,
        child: Text(
          c.name.isEmpty ? '?' : c.name.characters.first,
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w700,
            color: selected ? Colors.white : AppColors.primary,
          ),
        ),
      ),
      title: Row(children: [
        Flexible(
          child: Text(
            c.name,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontWeight: FontWeight.w600,
              color: selected ? AppColors.primary : AppColors.onSurface,
            ),
          ),
        ),
        if (selected) ...[
          const SizedBox(width: 6),
          const Icon(Icons.check_circle_rounded, size: 16, color: AppColors.primary),
        ],
      ]),
      subtitle: c.phone == null ? null : Text(c.phone!, style: const TextStyle(fontSize: 12)),
      trailing: owed <= 0
          ? null
          : Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
              Text('欠 ¥${owed.toStringAsFixed(owed % 1 == 0 ? 0 : 2)}',
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.error)),
              if (c.unpaidCount > 0)
                Text('${c.unpaidCount} 笔未结', style: const TextStyle(fontSize: 11, color: AppColors.onSurfaceVariant)),
            ]),
      onTap: () => Navigator.pop(context, c),
    );
  }
}
