/// 数据模型（与后端 API 对应，手写 fromJson 保持零代码生成依赖）
library;

/// 数量显示：整数不带小数点，小数最多3位去尾零（散称 0.5 斤 / 46.5）
String fmtQty(num q) {
  if (q == q.roundToDouble()) return q.toInt().toString();
  var s = q.toStringAsFixed(3);
  while (s.endsWith('0')) {
    s = s.substring(0, s.length - 1);
  }
  if (s.endsWith('.')) s = s.substring(0, s.length - 1);
  return s;
}

class FieldDef {
  final int? id;
  final String key;
  final String label;
  final String type; // text | number | select | date | boolean
  final String scope; // product=商品描述字段 | sku=规格维度
  final List<String>? options;
  final String? unit;
  final bool required;
  final bool affectsStock; // 仅sku字段：false=点单口味选项，不产生库存规格
  final bool showInList; // 商品列表副标题显示该字段值
  final int sortOrder;

  FieldDef({
    this.id,
    required this.key,
    required this.label,
    this.type = 'text',
    this.scope = 'product',
    this.options,
    this.unit,
    this.required = false,
    this.affectsStock = true,
    this.showInList = false,
    this.sortOrder = 0,
  });

  factory FieldDef.fromJson(Map<String, dynamic> j) => FieldDef(
        id: j['id'],
        key: j['key'],
        label: j['label'],
        type: j['type'] ?? 'text',
        scope: j['scope'] ?? 'product',
        options: j['options'] == null ? null : List<String>.from(j['options']),
        unit: j['unit'],
        required: j['required'] == 1 || j['required'] == true,
        affectsStock: j['affectsStock'] == null ? true : (j['affectsStock'] == 1 || j['affectsStock'] == true),
        showInList: j['showInList'] == 1 || j['showInList'] == true,
        sortOrder: j['sortOrder'] ?? 0,
      );

  Map<String, dynamic> toJson() => {
        'key': key,
        'label': label,
        'type': type,
        'scope': scope,
        if (options != null) 'options': options,
        if (unit != null) 'unit': unit,
        'required': required,
        'affectsStock': affectsStock,
        'showInList': showInList,
        'sortOrder': sortOrder,
      };
}

class ProductType {
  final int id;
  final String name;
  final String? icon;
  final String? description;
  final bool isPreset;
  final List<FieldDef> fields;
  final int productCount;

  ProductType({
    required this.id,
    required this.name,
    this.icon,
    this.description,
    this.isPreset = false,
    this.fields = const [],
    this.productCount = 0,
  });

  factory ProductType.fromJson(Map<String, dynamic> j) => ProductType(
        id: j['id'],
        name: j['name'],
        icon: j['icon'],
        description: j['description'],
        isPreset: j['isPreset'] == 1,
        fields: (j['fields'] as List? ?? []).map((f) => FieldDef.fromJson(f)).toList(),
        productCount: j['_count']?['products'] ?? 0,
      );
}

/// 规格（SKU）：价格/成本/条码/库存都在这层
class Sku {
  final int id;
  final String code;
  final Map<String, dynamic> specValues;
  final String specText; // "500ml · 53度"
  final double price;
  final double? costPrice;
  final String? barcode;
  final String? imageUrl; // 规格图（无则回退商品图）
  final bool isDefault;
  final double stock; // 支持散称小数
  final int minQuantity;

  Sku({
    required this.id,
    required this.code,
    this.specValues = const {},
    this.specText = '',
    this.price = 0,
    this.costPrice,
    this.barcode,
    this.imageUrl,
    this.isDefault = false,
    this.stock = 0,
    this.minQuantity = 0,
  });

  bool get isLow => minQuantity > 0 && stock <= minQuantity;
  String get displayName => specText.isEmpty ? '默认规格' : specText;

  factory Sku.fromJson(Map<String, dynamic> j) => Sku(
        id: j['id'],
        code: j['code'] ?? '',
        specValues: Map<String, dynamic>.from(j['specValues'] ?? {}),
        specText: j['specText'] ?? '',
        price: (j['price'] ?? 0).toDouble(),
        costPrice: j['costPrice']?.toDouble(),
        barcode: j['barcode'],
        imageUrl: j['imageUrl'],
        isDefault: j['isDefault'] == 1,
        stock: ((j['inventory']?['quantity'] ?? 0) as num).toDouble(),
        minQuantity: j['inventory']?['minQuantity'] ?? 0,
      );
}

class Product {
  final int id;
  final String code;
  final String name;
  final int productTypeId;
  final String unit;
  final double defaultPrice;
  final double? costPrice;
  final String? barcode;
  final String? imageUrl;
  final Map<String, dynamic> customFields;
  final List<Sku> skus;
  final double totalStock;
  final ProductType? productType;

  Product({
    required this.id,
    required this.code,
    required this.name,
    required this.productTypeId,
    this.unit = '件',
    this.defaultPrice = 0,
    this.costPrice,
    this.barcode,
    this.imageUrl,
    this.customFields = const {},
    this.skus = const [],
    this.totalStock = 0,
    this.productType,
  });

  bool get isLow => skus.any((s) => s.isLow);
  bool get hasSpecs => skus.length > 1 || (skus.length == 1 && skus.first.specText.isNotEmpty);
  Sku? get defaultSku => skus.isEmpty ? null : skus.firstWhere((s) => s.isDefault, orElse: () => skus.first);

  /// 搜索匹配：名称/编码/条码/规格文本（商品列表、开单/进货选货、盘点共用）
  bool matches(String query) {
    final q = query.trim().toLowerCase();
    if (q.isEmpty) return true;
    bool hit(String? s) => s != null && s.toLowerCase().contains(q);
    return hit(name) || hit(code) || hit(barcode) || skus.any((s) => hit(s.specText) || hit(s.barcode) || hit(s.code));
  }

  factory Product.fromJson(Map<String, dynamic> j) => Product(
        id: j['id'],
        code: j['code'],
        name: j['name'],
        productTypeId: j['productTypeId'],
        unit: j['unit'] ?? '件',
        defaultPrice: (j['defaultPrice'] ?? 0).toDouble(),
        costPrice: j['costPrice']?.toDouble(),
        barcode: j['barcode'],
        imageUrl: j['imageUrl'],
        customFields: Map<String, dynamic>.from(j['customFields'] ?? {}),
        skus: (j['skus'] as List? ?? []).map((s) => Sku.fromJson(s)).toList(),
        totalStock: ((j['totalStock'] ?? 0) as num).toDouble(),
        productType: j['productType'] == null ? null : ProductType.fromJson(j['productType']),
      );
}

class Customer {
  final int id;
  final String name;
  final String? phone;
  final String? address;
  final String? notes;
  final int? productTypeId; // 主营品类：开单只显示该品类商品（null=不限）
  final double owed; // 当前欠款（列表接口聚合返回）
  final int unpaidCount;
  Customer({
    required this.id,
    required this.name,
    this.phone,
    this.address,
    this.notes,
    this.productTypeId,
    this.owed = 0,
    this.unpaidCount = 0,
  });
  factory Customer.fromJson(Map<String, dynamic> j) => Customer(
        id: j['id'],
        name: j['name'],
        phone: j['phone'],
        address: j['address'],
        notes: j['notes'],
        productTypeId: j['productTypeId'],
        owed: ((j['owed'] ?? 0) as num).toDouble(),
        unpaidCount: j['unpaidCount'] ?? 0,
      );
}

class OrderSummary {
  final int id;
  final String orderNo;
  final String status;
  final double totalAmount;
  final double actualAmount;
  final double paidAmount;
  final double unpaidAmount; // 欠款
  final String? settlementAccount;
  final String customerName;
  final int itemCount;
  final DateTime createdAt;

  OrderSummary({
    required this.id,
    required this.orderNo,
    required this.status,
    required this.totalAmount,
    required this.actualAmount,
    required this.paidAmount,
    required this.unpaidAmount,
    this.settlementAccount,
    required this.customerName,
    required this.itemCount,
    required this.createdAt,
  });

  factory OrderSummary.fromJson(Map<String, dynamic> j) => OrderSummary(
        id: j['id'],
        orderNo: j['orderNo'],
        status: j['status'],
        totalAmount: (j['totalAmount'] ?? 0).toDouble(),
        actualAmount: (j['actualAmount'] ?? 0).toDouble(),
        paidAmount: (j['paidAmount'] ?? 0).toDouble(),
        unpaidAmount: (j['unpaidAmount'] ?? 0).toDouble(),
        settlementAccount: j['settlementAccount'],
        customerName: j['customer']?['name'] ?? '-',
        itemCount: j['_count']?['items'] ?? 0,
        createdAt: DateTime.parse(j['createdAt']).toLocal(),
      );
}

class Supplier {
  final int id;
  final String name;
  final String? phone;
  final String? address;
  Supplier({required this.id, required this.name, this.phone, this.address});
  factory Supplier.fromJson(Map<String, dynamic> j) =>
      Supplier(id: j['id'], name: j['name'], phone: j['phone'], address: j['address']);
}

class PurchaseOrderSummary {
  final int id;
  final String orderNo;
  final String status;
  final double actualAmount;
  final double unpaidAmount;
  final String supplierName;
  final int itemCount;
  final DateTime createdAt;

  PurchaseOrderSummary({
    required this.id,
    required this.orderNo,
    required this.status,
    required this.actualAmount,
    required this.unpaidAmount,
    required this.supplierName,
    required this.itemCount,
    required this.createdAt,
  });

  factory PurchaseOrderSummary.fromJson(Map<String, dynamic> j) => PurchaseOrderSummary(
        id: j['id'],
        orderNo: j['orderNo'],
        status: j['status'],
        actualAmount: (j['actualAmount'] ?? 0).toDouble(),
        unpaidAmount: (j['unpaidAmount'] ?? 0).toDouble(),
        supplierName: j['supplier']?['name'] ?? '无供应商',
        itemCount: j['_count']?['items'] ?? 0,
        createdAt: DateTime.parse(j['createdAt']).toLocal(),
      );
}

class Overview {
  final double todaySales;
  final int todayOrderCount;
  final double todayExpenses;
  final double todayCogs;
  final double todayProfit;
  final int lowStockCount;
  final int productCount;
  /// 有商品卖出时没有成本数据 → 毛利偏高，不能当准数看
  final bool profitUnreliable;
  final double noCostSales;
  final List<String> noCostProductNames;

  Overview({
    required this.todaySales,
    required this.todayOrderCount,
    required this.todayExpenses,
    required this.todayCogs,
    required this.todayProfit,
    required this.lowStockCount,
    required this.productCount,
    this.profitUnreliable = false,
    this.noCostSales = 0,
    this.noCostProductNames = const [],
  });

  factory Overview.fromJson(Map<String, dynamic> j) => Overview(
        todaySales: (j['todaySales'] ?? 0).toDouble(),
        todayOrderCount: j['todayOrderCount'] ?? 0,
        todayExpenses: (j['todayExpenses'] ?? 0).toDouble(),
        todayCogs: (j['todayCogs'] ?? 0).toDouble(),
        todayProfit: (j['todayProfit'] ?? 0).toDouble(),
        lowStockCount: j['lowStockCount'] ?? 0,
        productCount: j['productCount'] ?? 0,
        profitUnreliable: j['profitUnreliable'] == true,
        noCostSales: (j['noCostSales'] ?? 0).toDouble(),
        noCostProductNames: List<String>.from(j['noCostProductNames'] ?? const []),
      );
}

/// 口述录入解析结果
class ParsedItem {
  String name;
  double quantity;
  String unit;
  double? totalCost;
  double? unitCost;
  int? matchedProductId;
  String? matchedProductName;
  int? productTypeId; // 新建商品归属品类（AI 建议预填，用户可改）
  String? productTypeName;

  ParsedItem({
    required this.name,
    required this.quantity,
    this.unit = '件',
    this.totalCost,
    this.unitCost,
    this.matchedProductId,
    this.matchedProductName,
    this.productTypeId,
    this.productTypeName,
  });

  factory ParsedItem.fromJson(Map<String, dynamic> j) => ParsedItem(
        name: j['name'] ?? '未知商品',
        quantity: (j['quantity'] ?? 0).toDouble(),
        unit: j['unit'] ?? '件',
        totalCost: j['totalCost']?.toDouble(),
        unitCost: j['unitCost']?.toDouble(),
        matchedProductId: j['matchedProduct']?['id'],
        matchedProductName: j['matchedProduct']?['name'],
        productTypeId: j['suggestedType']?['id'], // AI 建议直接预填
        productTypeName: j['suggestedType']?['name'],
      );
}

class ParsedExpense {
  String category;
  double amount;
  String? note;
  ParsedExpense({required this.category, required this.amount, this.note});
  factory ParsedExpense.fromJson(Map<String, dynamic> j) =>
      ParsedExpense(category: j['category'] ?? '其他', amount: (j['amount'] ?? 0).toDouble(), note: j['note']);
}

/// 卖出条目可选的规格（含库存，用于扣库存前检查）
class SaleSkuOption {
  final int id;
  final String specText;
  final double price;
  final bool isDefault;
  final int stock;
  final double suggestedPrice; // 建议价（专属/上次/标价 三级解析）
  final String priceSource; // customer | last | default
  SaleSkuOption({
    required this.id,
    required this.specText,
    required this.price,
    required this.isDefault,
    required this.stock,
    required this.suggestedPrice,
    required this.priceSource,
  });
  String get displayName => specText.isEmpty ? '默认规格' : specText;
  String get priceSourceLabel => switch (priceSource) { 'customer' => '专属价', 'last' => '上次价', _ => '标价' };
  factory SaleSkuOption.fromJson(Map<String, dynamic> j) => SaleSkuOption(
        id: j['id'],
        specText: j['specText'] ?? '',
        price: (j['price'] ?? 0).toDouble(),
        isDefault: j['isDefault'] == true,
        stock: j['stock'] ?? 0,
        suggestedPrice: (j['suggestedPrice'] ?? j['price'] ?? 0).toDouble(),
        priceSource: j['priceSource'] ?? 'default',
      );
}

/// 口述卖出条目
class ParsedSale {
  String name;
  double quantity;
  String unit;
  double? totalAmount;
  double? unitPrice;
  int? matchedProductId;
  String? matchedProductName;
  int? customerId; // 卖给谁（null=散客）
  String? customerName;
  List<SaleSkuOption> skuOptions;
  int? skuId; // 选中的规格（null = 未建档，只记收入）
  bool? paid; // 收没收到钱（null=没提；记名客户没提→后端记挂账）

  ParsedSale({
    required this.name,
    required this.quantity,
    this.unit = '件',
    this.totalAmount,
    this.unitPrice,
    this.matchedProductId,
    this.matchedProductName,
    this.customerId,
    this.customerName,
    this.skuOptions = const [],
    this.skuId,
    this.paid,
  });

  SaleSkuOption? get chosenSku => skuOptions.where((s) => s.id == skuId).firstOrNull;
  bool get stockInsufficient => chosenSku != null && quantity > chosenSku!.stock;
  bool get priceUnstated => totalAmount == null && unitPrice == null;
  /// 展示/汇总用的实际金额：明说金额 > 建议价×量
  double get effectiveAmount =>
      totalAmount ?? (unitPrice ?? chosenSku?.suggestedPrice ?? 0) * quantity;

  factory ParsedSale.fromJson(Map<String, dynamic> j) {
    final matched = j['matchedProduct'];
    final options = (matched?['skus'] as List? ?? []).map((x) => SaleSkuOption.fromJson(x)).toList();
    final def = options.where((s) => s.isDefault).firstOrNull ?? options.firstOrNull;
    return ParsedSale(
      name: j['name'] ?? '未知商品',
      quantity: (j['quantity'] ?? 0).toDouble(),
      unit: j['unit'] ?? '件',
      totalAmount: j['totalAmount']?.toDouble(),
      unitPrice: j['unitPrice']?.toDouble(),
      matchedProductId: matched?['id'],
      matchedProductName: matched?['name'],
      customerId: j['customer']?['id'],
      customerName: j['customer']?['name'],
      skuOptions: options,
      // 收没收钱必须原样带过来：漏了这个字段，AI 明明听出"老王给现金了"，
      // 后端却按"记名客户没说收钱"判成挂账 —— 老板会去找已经付过钱的客户要账
      paid: j['paid'] as bool?,
      // 后端已按口述规格词（"单瓶/整箱"）定位规格，优先跟随；没有再落默认规格
      skuId: (j['suggestedSkuId'] as int?) ?? def?.id,
    );
  }
}

/// 汇总营业额（"今天一共收了1280"，只有总数没有明细）
class ParsedAggregate {
  String label;
  double amount;
  String? note;
  ParsedAggregate({required this.label, required this.amount, this.note});
  factory ParsedAggregate.fromJson(Map<String, dynamic> j) =>
      ParsedAggregate(label: j['label'] ?? '营业额', amount: (j['amount'] ?? 0).toDouble(), note: j['note']);
}

class ParseResult {
  final List<ParsedItem> purchases;
  final List<ParsedSale> sales;
  final List<ParsedExpense> expenses;
  final List<ParsedAggregate> aggregates;
  final List<String> warnings;
  final String? deliveryNote; // 客户订单模式：送货时间/地址
  final String? supplierName; // 进货单据模式：识别出的供应商
  ParseResult({
    required this.purchases,
    required this.sales,
    required this.expenses,
    required this.aggregates,
    required this.warnings,
    this.deliveryNote,
    this.supplierName,
  });
  factory ParseResult.fromJson(Map<String, dynamic> j) => ParseResult(
        purchases: (j['purchases'] as List? ?? []).map((x) => ParsedItem.fromJson(x)).toList(),
        sales: (j['sales'] as List? ?? []).map((x) => ParsedSale.fromJson(x)).toList(),
        expenses: (j['expenses'] as List? ?? []).map((x) => ParsedExpense.fromJson(x)).toList(),
        aggregates: (j['aggregates'] as List? ?? []).map((x) => ParsedAggregate.fromJson(x)).toList(),
        warnings: List<String>.from(j['warnings'] ?? []),
        deliveryNote: j['deliveryNote'],
        supplierName: j['supplierName'],
      );
}
