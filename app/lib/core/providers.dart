import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'api.dart';
import 'models.dart';

/// 断网降级：网络错误时回放上次成功的数据（只读缓存）。
/// 摊位上信号说没就没，「查库存/看客户」这种读操作不该跟着一起死。
/// 写操作照常报错——绝不假装提交成功。
Future<List<dynamic>> _cachedList(String key, Future<List<dynamic>> Function() fetch) async {
  final sp = await SharedPreferences.getInstance();
  try {
    final fresh = await fetch();
    await sp.setString('lcache_$key', jsonEncode(fresh));
    return fresh;
  } catch (e) {
    final isNetwork = e is ApiError && e.status == null;
    if (isNetwork) {
      final cached = sp.getString('lcache_$key');
      if (cached != null) return jsonDecode(cached) as List<dynamic>;
    }
    rethrow;
  }
}

/// 登录状态
final authProvider = StateNotifierProvider<AuthNotifier, bool>((ref) => AuthNotifier());

class AuthNotifier extends StateNotifier<bool> {
  AuthNotifier() : super(Api.I.hasToken);

  Future<void> login(String username, String password) async {
    final data = await Api.I.post('/auth/login', data: {'username': username, 'password': password});
    await Api.I.setToken(data['token']);
    state = true;
  }

  /// 注册即登录
  Future<void> register(String username, String password, String? realName) async {
    final data = await Api.I.post('/auth/register', data: {
      'username': username,
      'password': password,
      if (realName != null && realName.isNotEmpty) 'realName': realName,
    });
    await Api.I.setToken(data['token']);
    state = true;
  }

  /// 平台账号登录（iOS=Apple；huawei/wechat 待接入）
  Future<void> oauthLogin({required String provider, String? identityToken, String? fullName}) async {
    final data = await Api.I.post('/auth/oauth', data: {
      'provider': provider,
      if (identityToken != null) 'identityToken': identityToken,
      if (fullName != null && fullName.isNotEmpty) 'fullName': fullName,
    });
    await Api.I.setToken(data['token']);
    state = true;
  }

  Future<void> logout() async {
    await Api.I.setToken(null);
    state = false;
  }
}

/// 当前用户资料
final profileProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  final data = await Api.I.get('/auth/profile');
  return Map<String, dynamic>.from(data);
});

/// 缺货规格列表（首页"该补货了"卡 + 通知中心共用）
final lowStockProvider = FutureProvider<List<Map<String, dynamic>>>((ref) async {
  final d = await Api.I.get('/inventory/alerts');
  return List<Map<String, dynamic>>.from(d);
});

/// 主营品类：一个人通常只做一门生意，设一次之后商品页/开单/进货/盘点/建品全默认它。
/// 没设过但只有一个品类时，自动把它当主营（新用户零配置就享受默认）。
final mainTypeIdProvider = Provider<int?>((ref) {
  final saved = ref.watch(profileProvider).valueOrNull?['mainTypeId'] as int?;
  if (saved != null) return saved;
  final types = ref.watch(typesProvider).valueOrNull;
  if (types != null && types.length == 1) return types.first.id;
  return null;
});

/// 品类列表（全局缓存，多处使用）
final typesProvider = FutureProvider<List<ProductType>>((ref) async {
  final data = await _cachedList('types', () async => (await Api.I.get('/product-types')) as List);
  return data.map((x) => ProductType.fromJson(x)).toList();
});

/// 首页看板
final overviewProvider = FutureProvider<Overview>((ref) async {
  final data = await Api.I.get('/stats/overview');
  return Overview.fromJson(data);
});

/// 商品列表（选货弹窗等一次性场景用；上限 200，超量时靠 productSearchProvider 搜）
final productsProvider = FutureProvider.family<List<Product>, int?>((ref, typeId) async {
  final data = await _cachedList('products_${typeId ?? 'all'}', () async {
    final d = await Api.I.get('/products', query: {
      'pageSize': 200,
      if (typeId != null) 'productTypeId': typeId,
    });
    return d['list'] as List;
  });
  return data.map((x) => Product.fromJson(x)).toList();
});

/// 商品分页查询条件（品类 + 关键词），值相等即命中同一份缓存
class ProductQuery {
  final int? typeId;
  final String keyword;
  const ProductQuery({this.typeId, this.keyword = ''});

  ProductQuery copyWith({int? typeId, bool clearType = false, String? keyword}) => ProductQuery(
        typeId: clearType ? null : (typeId ?? this.typeId),
        keyword: keyword ?? this.keyword,
      );

  @override
  bool operator ==(Object other) =>
      other is ProductQuery && other.typeId == typeId && other.keyword == keyword;
  @override
  int get hashCode => Object.hash(typeId, keyword);
}

/// 分页结果：累积的已加载商品 + 还有没有下一页
class ProductPage {
  final List<Product> items;
  final int total;
  final bool loadingMore;
  const ProductPage({this.items = const [], this.total = 0, this.loadingMore = false});

  bool get hasMore => items.length < total;
}

/// 商品分页列表：搜索和筛选都走服务端，滚到底加载下一页
/// （之前写死 pageSize:100，商品超过 100 个后面的直接看不见）
class ProductListNotifier extends StateNotifier<AsyncValue<ProductPage>> {
  final ProductQuery query;
  static const _pageSize = 30;
  int _page = 1;

  ProductListNotifier(this.query) : super(const AsyncValue.loading()) {
    refresh();
  }

  Future<void> refresh() async {
    _page = 1;
    state = const AsyncValue.loading();
    try {
      state = AsyncValue.data(await _fetch(1, const []));
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  Future<void> loadMore() async {
    final cur = state.valueOrNull;
    if (cur == null || cur.loadingMore || !cur.hasMore) return;
    state = AsyncValue.data(ProductPage(items: cur.items, total: cur.total, loadingMore: true));
    try {
      state = AsyncValue.data(await _fetch(_page + 1, cur.items));
      _page++;
    } catch (_) {
      // 加载下一页失败不该把已加载的列表也清掉
      state = AsyncValue.data(ProductPage(items: cur.items, total: cur.total));
    }
  }

  Future<ProductPage> _fetch(int page, List<Product> prev) async {
    final data = await Api.I.get('/products', query: {
      'page': page,
      'pageSize': _pageSize,
      if (query.typeId != null) 'productTypeId': query.typeId,
      if (query.keyword.trim().isNotEmpty) 'keyword': query.keyword.trim(),
    });
    final fresh = (data['list'] as List).map((x) => Product.fromJson(x)).toList();
    return ProductPage(
      items: [...prev, ...fresh],
      total: (data['pagination']?['total'] ?? fresh.length) as int,
    );
  }
}

final productListProvider =
    StateNotifierProvider.family<ProductListNotifier, AsyncValue<ProductPage>, ProductQuery>(
  (ref, q) => ProductListNotifier(q),
);

/// 商品/库存变动后统一刷新：一次性列表（选货弹窗用）和分页列表（商品页用）都要刷。
/// 只刷一个会出现「开完单回商品页库存没变」这类幽灵问题。
/// ref 用 dynamic 是因为 WidgetRef 和 Ref 没有公共基类，两者都有 invalidate。
void invalidateProducts(dynamic ref) {
  ref.invalidate(productsProvider);
  ref.invalidate(productListProvider);
}

/// 客户列表：逐页拉全。原来写死 pageSize:100，客户超过 100 个之后
/// 开单弹窗里根本搜不到人，而界面上没有任何迹象说明「还有没显示的」。
final customersProvider = FutureProvider<List<Customer>>((ref) async {
  final all = await _cachedList('customers', () => _fetchAllPages('/customers'));
  return all.map((x) => Customer.fromJson(x)).toList();
});

/// 逐页拉全某个分页接口（用于开单选人这类必须"看得到全部"的场景）
Future<List<dynamic>> _fetchAllPages(String path, {int pageSize = 200, int maxPages = 50}) async {
  final out = <dynamic>[];
  var page = 1;
  while (page <= maxPages) {
    final d = await Api.I.get(path, query: {'page': page, 'pageSize': pageSize});
    final chunk = d['list'] as List;
    out.addAll(chunk);
    final total = (d['pagination']?['total'] ?? out.length) as int;
    if (out.length >= total || chunk.isEmpty) break;
    page++;
  }
  return out;
}

/// 订单列表（最近 200 张；更早的靠列表页的搜索/状态筛选找，欠款合计走服务端 unpaidOnly）
final ordersProvider = FutureProvider<List<OrderSummary>>((ref) async {
  final data = await Api.I.get('/orders', query: {'pageSize': 200});
  return (data['list'] as List).map((x) => OrderSummary.fromJson(x)).toList();
});

/// 进货单列表（最近 200 张，同上）
final purchaseOrdersProvider = FutureProvider<List<PurchaseOrderSummary>>((ref) async {
  final data = await Api.I.get('/purchase-orders', query: {'pageSize': 200});
  return (data['list'] as List).map((x) => PurchaseOrderSummary.fromJson(x)).toList();
});

/// 供应商列表
final suppliersProvider = FutureProvider<List<Supplier>>((ref) async {
  final all = await _cachedList('suppliers', () => _fetchAllPages('/suppliers'));
  return all.map((x) => Supplier.fromJson(x)).toList();
});

/// 权益 + 今日 AI 额度。口述页拿它显示"今天还剩 N 次"——
/// 让用户对额度**始终有感知**，而不是用到第 9 次突然撞墙。
/// coreLimit/otherLimit 为 null = 不限（付费版或未配置额度）。
final entitlementProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  final d = await Api.I.get('/me/entitlement');
  return Map<String, dynamic>.from(d);
});
