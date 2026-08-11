// 商品分页真跑测试：直连本地后端(:3100)，验证「滚到底加载下一页」的数据链路。
// 之前商品列表写死 pageSize:100，超 100 个商品后面的直接看不见，这个测试守住回归。
//
// 自带数据：建一个临时品类 + 45 个商品，跑完全部删掉，不污染真实数据。
// 跑法：后端起在 3100 → flutter test test/product_pagination_test.dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stockmate/core/api.dart';
import 'package:stockmate/core/providers.dart';

const _seedCount = 45; // 要大于一页(30)，才测得出翻页
const _typeName = '__分页测试品类__';
const _namePrefix = '__分页测试品';

late int _typeId;

/// 等 notifier 首屏加载完
Future<ProductPage> _firstPage(ProductListNotifier n) async {
  for (var i = 0; i < 100 && n.state.value == null; i++) {
    await Future.delayed(const Duration(milliseconds: 50));
  }
  final v = n.state.value;
  if (v == null) throw StateError('首屏一直没加载出来，后端是不是没起在 3100？');
  return v;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  SharedPreferences.setMockInitialValues({});
  // flutter test 默认把所有 HTTP 拦成 400，这里放行——本测试就是要打真后端
  HttpOverrides.global = null;

  setUpAll(() async {
    final auth = await Api.I.post('/auth/login', data: {'username': 'admin', 'password': 'admin123'});
    await Api.I.setToken(auth['token']);

    // 临时品类：不带任何自定义字段，避开必填校验
    final type = await Api.I.post('/product-types', data: {'name': _typeName, 'description': '自动化测试用，跑完会删'});
    _typeId = type['id'];

    await Api.I.post('/products/batch', data: {
      'productTypeId': _typeId,
      'products': [
        for (var i = 1; i <= _seedCount; i++)
          {
            'name': '$_namePrefix${i.toString().padLeft(3, '0')}',
            'unit': '件',
            'skus': [
              {'price': 10.0 + i, 'initQuantity': i}
            ],
          }
      ],
    });
  });

  tearDownAll(() async {
    // 删商品再删品类，不留垃圾
    final d = await Api.I.get('/products', query: {'productTypeId': _typeId, 'pageSize': 500});
    for (final p in (d['list'] as List)) {
      await Api.I.delete('/products/${p['id']}');
    }
    await Api.I.delete('/product-types/$_typeId');
  });

  test('分页：首屏只拉一页、逐页累积、不重不漏、到底停止', () async {
    final n = ProductListNotifier(ProductQuery(typeId: _typeId));
    var page = await _firstPage(n);

    expect(page.total, _seedCount, reason: '总数应等于造的数据量');
    expect(page.items.length, 30, reason: '首屏只该拉一页 30 条，不是一把梭全拉');
    expect(page.hasMore, isTrue);

    var guard = 0;
    while (n.state.value!.hasMore && guard++ < 20) {
      await n.loadMore();
    }
    page = n.state.value!;

    expect(page.items.length, _seedCount, reason: '翻到底要正好等于总数，一条都不能少');
    expect(page.hasMore, isFalse, reason: '到底之后不能还说有下一页');

    final ids = page.items.map((p) => p.id).toList();
    expect(ids.toSet().length, ids.length, reason: '分页不能出现重复商品');
  });

  test('服务端搜索：命中商品名，且结果不受分页截断', () async {
    final n = ProductListNotifier(ProductQuery(typeId: _typeId, keyword: _namePrefix));
    final page = await _firstPage(n);
    expect(page.total, _seedCount, reason: '搜索的总数要算全量，不是当页');
    expect(page.items.every((p) => p.name.contains(_namePrefix)), isTrue);
  });

  test('服务端搜索：规格文本也能搜到（搜索框写了「规格」就得真能搜）', () async {
    // 「超大杯」只存在于 SKU 的 specText，商品名里没有
    final n = ProductListNotifier(const ProductQuery(keyword: '超大杯'));
    final page = await _firstPage(n);
    expect(page.items, isNotEmpty, reason: '规格文本搜不到的话，搜索框的提示就是骗人的');
    expect(page.items.any((p) => p.name.contains('超大杯')), isFalse, reason: '确认命中的是规格不是商品名');
  });

  test('搜索无结果返回空列表而不是报错', () async {
    final n = ProductListNotifier(const ProductQuery(keyword: '这个商品肯定不存在zzz'));
    final page = await _firstPage(n);
    expect(page.items, isEmpty);
    expect(page.hasMore, isFalse);
  });
}
