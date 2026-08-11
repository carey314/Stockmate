// 前端纯逻辑单测：不依赖后端、不依赖渲染，跑得飞快。
// 挑的都是"算错会直接体现在钱和数量上"的地方。
// 跑法：flutter test test/
import 'package:flutter_test/flutter_test.dart';
import 'package:stockmate/core/models.dart';

void main() {
  group('fmtQty · 数量显示（散称小数是刚需，但整数不能显示成 3.000）', () {
    test('整数不带小数点', () {
      expect(fmtQty(3), '3');
      expect(fmtQty(3.0), '3');
      expect(fmtQty(0), '0');
    });

    test('小数去掉多余的 0', () {
      expect(fmtQty(2.5), '2.5');
      expect(fmtQty(2.50), '2.5');
      expect(fmtQty(0.25), '0.25');
    });

    test('保留到 3 位（称重最细到克/钱）', () {
      expect(fmtQty(2.355), '2.355');
      expect(fmtQty(0.001), '0.001');
    });

    test('负数（退货/盘亏场景）也能正常显示', () {
      expect(fmtQty(-1.5), '-1.5');
      expect(fmtQty(-2), '-2');
    });
  });

  group('ParsedSale · 口述解析出来的卖出条目', () {
    Map<String, dynamic> sale({
      double? totalAmount,
      double? unitPrice,
      double quantity = 2,
      int? suggestedSkuId,
      List<Map<String, dynamic>>? skus,
    }) =>
        {
          'name': '泸州老窖',
          'quantity': quantity,
          'unit': '瓶',
          if (totalAmount != null) 'totalAmount': totalAmount,
          if (unitPrice != null) 'unitPrice': unitPrice,
          if (suggestedSkuId != null) 'suggestedSkuId': suggestedSkuId,
          'matchedProduct': {
            'id': 4,
            'name': '泸州老窖',
            'unit': '瓶',
            'skus': skus ??
                [
                  {'id': 10, 'specText': '整箱', 'price': 2760, 'isDefault': true, 'stock': 5, 'suggestedPrice': 2760, 'priceSource': 'default'},
                  {'id': 11, 'specText': '单瓶', 'price': 128, 'isDefault': false, 'stock': 40, 'suggestedPrice': 118, 'priceSource': 'customer'},
                ],
          },
        };

    test('后端给了 suggestedSkuId 就跟它走（口述"5瓶单瓶的"不能扣成整箱）', () {
      final s = ParsedSale.fromJson(sale(suggestedSkuId: 11));
      expect(s.skuId, 11);
      expect(s.chosenSku?.specText, '单瓶');
    });

    test('没有 suggestedSkuId 才落到默认规格', () {
      final s = ParsedSale.fromJson(sale());
      expect(s.skuId, 10);
      expect(s.chosenSku?.isDefault, true);
    });

    test('总价优先：说了"收75块"就按 75 算，不再拿单价乘数量', () {
      final s = ParsedSale.fromJson(sale(totalAmount: 75, unitPrice: 100));
      expect(s.effectiveAmount, 75);
    });

    test('只说单价时按 单价×数量 算', () {
      final s = ParsedSale.fromJson(sale(unitPrice: 118, quantity: 5));
      expect(s.effectiveAmount, 590);
    });

    test('价格全没说时退到选中规格的建议价（专属价 118 而不是标价 128）', () {
      final s = ParsedSale.fromJson(sale(suggestedSkuId: 11, quantity: 5));
      expect(s.chosenSku?.suggestedPrice, 118);
      expect(s.effectiveAmount, 590);
    });

    test('没匹配到商品时不炸，金额算 0（只记收入不扣库存的场景）', () {
      final s = ParsedSale.fromJson({'name': '不认识的货', 'quantity': 3, 'unit': '个'});
      expect(s.skuId, isNull);
      expect(s.matchedProductId, isNull);
      expect(s.effectiveAmount, 0);
    });

    test('挂账语义：paid 为 false 时保持 false，不能被当成"已收"', () {
      final s = ParsedSale.fromJson({...sale(), 'paid': false});
      expect(s.paid, false);
      final unknown = ParsedSale.fromJson(sale());
      expect(unknown.paid, isNull, reason: '没说收没收钱就是未知，不能默认已收');
    });
  });

  group('ParseResult · 整份解析结果', () {
    test('四类条目和警告都能解析，缺字段不炸', () {
      final r = ParseResult.fromJson({
        'purchases': [
          {'name': '面粉', 'quantity': 25.5, 'unit': '斤'}
        ],
        'sales': [
          {'name': '馄饨', 'quantity': 3, 'unit': '袋', 'totalAmount': 75}
        ],
        'expenses': [
          {'category': '摊位费', 'amount': 50}
        ],
        'aggregates': [
          {'label': '今日营业额', 'amount': 800}
        ],
        'warnings': ['「面粉」没说是进还是出'],
      });
      expect(r.purchases.single.quantity, 25.5);
      expect(r.sales.single.effectiveAmount, 75);
      expect(r.expenses.single.amount, 50);
      expect(r.aggregates.single.amount, 800);
      expect(r.warnings.single.contains('没说'), true);
    });

    test('空响应解析成空列表而不是 null', () {
      final r = ParseResult.fromJson({});
      expect(r.purchases, isEmpty);
      expect(r.sales, isEmpty);
      expect(r.warnings, isEmpty);
    });
  });
}
