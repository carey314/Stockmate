const { z } = require('zod');
const prisma = require('../config/prisma');
const { ok, created, fail } = require('../utils/response');
const { httpError, parseJson, serializeProduct, buildSpecText, genProductCode } = require('../utils/biz');

const skuInputSchema = z.object({
  specValues: z.record(z.any()).default({}),
  price: z.number().nonnegative().default(0),
  costPrice: z.number().nonnegative().nullish(),
  barcode: z.string().nullish(),
  imageUrl: z.string().nullish(), // 规格图（服装同款不同色）
  initQuantity: z.number().nonnegative().default(0), // 初始库存（支持散称小数）
  minQuantity: z.number().int().nonnegative().default(0),
});

const productSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1, '商品名称不能为空'),
  productTypeId: z.number().int(),
  unit: z.string().default('件'),
  defaultPrice: z.number().nonnegative().default(0),
  costPrice: z.number().nonnegative().nullish(),
  barcode: z.string().nullish(),
  imageUrl: z.string().nullish(),
  customFields: z.record(z.any()).default({}),
  minQuantity: z.number().int().nonnegative().optional(),
  skus: z.array(skuInputSchema).optional(), // 不传 = 自动建默认规格
});

// 校验字段值（按 scope 区分商品字段/规格维度）
const validateFields = async (productTypeId, values, scope) => {
  const fields = await prisma.fieldDefinition.findMany({ where: { productTypeId, scope } });
  const errors = [];
  for (const f of fields) {
    const v = values[f.key];
    if (f.required === 1 && (v === undefined || v === null || v === '')) {
      errors.push({ field: f.key, message: `${f.label} 为必填` });
      continue;
    }
    if (v === undefined || v === null || v === '') continue;
    if (f.type === 'number' && typeof v !== 'number') errors.push({ field: f.key, message: `${f.label} 应为数字` });
    if (f.type === 'boolean' && typeof v !== 'boolean') errors.push({ field: f.key, message: `${f.label} 应为布尔值` });
    if (f.type === 'select') {
      const opts = parseJson(f.options, []);
      if (opts.length && !opts.includes(v)) errors.push({ field: f.key, message: `${f.label} 取值须为：${opts.join('/')}` });
    }
  }
  return errors;
};


// 规格查重：键排序后比较，避免 {a,b} 与 {b,a} 判成不同
const normSpec = (v) => {
  const obj = typeof v === 'string' ? JSON.parse(v || '{}') : v || {};
  return JSON.stringify(Object.keys(obj).sort().map((k) => [k, obj[k]]));
};
const assertSpecUnique = async (productId, specValues, excludeSkuId = null) => {
  const target = normSpec(specValues);
  const skus = await prisma.sku.findMany({ where: { productId, status: 1 }, select: { id: true, specValues: true, specText: true } });
  const dup = skus.find((x) => x.id !== excludeSkuId && normSpec(x.specValues) === target);
  if (dup) throw httpError(400, `这个规格已经存在了（${dup.specText || '默认规格'}），别建重复的`);
};

const includeFull = {
  productType: { include: { fields: { orderBy: { sortOrder: 'asc' } } } },
  skus: { where: { status: 1 }, include: { inventory: true }, orderBy: [{ isDefault: 'desc' }, { id: 'asc' }] },
};

exports.list = async (req, res) => {
  const { page = 1, pageSize = 20, keyword, productTypeId } = req.query;
  const where = {
    isDeleted: 0,
    ...(productTypeId ? { productTypeId: Number(productTypeId) } : {}),
    // 搜索覆盖：商品名/编码/条码 + 规格文本/规格编码/规格条码（跟 App 端搜索框提示一致）
    ...(keyword
      ? {
          OR: [
            { name: { contains: keyword } },
            { code: { contains: keyword } },
            { barcode: { contains: keyword } },
            { skus: { some: { specText: { contains: keyword } } } },
            { skus: { some: { code: { contains: keyword } } } },
            { skus: { some: { barcode: { contains: keyword } } } },
            { customFields: { contains: keyword } }, // 自定义字段值（如厂家/品牌）也能搜
          ],
        }
      : {}),
  };
  const [total, list] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: { productType: true, skus: { where: { status: 1 }, include: { inventory: true }, orderBy: [{ isDefault: 'desc' }, { id: 'asc' }] } },
      orderBy: { id: 'desc' },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);
  return ok(res, {
    list: list.map(serializeProduct),
    pagination: { page: Number(page), pageSize: Number(pageSize), total, totalPages: Math.ceil(total / Number(pageSize)) },
  });
};

exports.detail = async (req, res) => {
  const id = Number(req.params.id);
  const product = await prisma.product.findFirst({ where: { id, isDeleted: 0 }, include: includeFull });
  if (!product) throw httpError(404, '商品不存在');
  return ok(res, serializeProduct(product));
};

// 建品核心（单个/批量共用）：校验 → 建商品 → 建 SKU+库存(+初始入库流水)
const createProductCore = async (data, operatorId, { strict = true } = {}) => {
  // 本店归属校验：品类必须是本店的（跨店 typeId 会让 validateFields 查到空字段静默通过）
  const ownedType = await prisma.productType.findFirst({ where: { id: data.productTypeId, isDeleted: 0 } });
  if (!ownedType) { const e = new Error('品类不存在'); e.status = 404; throw e; }
  const errors = await validateFields(data.productTypeId, data.customFields ?? {}, 'product');
  if (strict && errors.length) {
    const e = new Error(errors.map((x) => x.message).join('；'));
    e.status = 400;
    e.fieldErrors = errors;
    throw e;
  }

  const skuFields = await prisma.fieldDefinition.findMany({ where: { productTypeId: data.productTypeId, scope: 'sku' } });
  const skuInputs = data.skus?.length
    ? data.skus
    : [{ specValues: {}, price: data.defaultPrice ?? 0, costPrice: data.costPrice, barcode: data.barcode, initQuantity: 0, minQuantity: data.minQuantity ?? 0 }];

  if (strict) {
    for (const s of skuInputs) {
      const skuErrors = await validateFields(data.productTypeId, s.specValues ?? {}, 'sku');
      if (skuErrors.length) {
        const e = new Error(skuErrors.map((x) => x.message).join('；'));
        e.status = 400;
        e.fieldErrors = skuErrors;
        throw e;
      }
    }
  }

  const code = data.code || genProductCode();
  const product = await prisma.product.create({
    data: {
      code,
      name: data.name,
      productTypeId: data.productTypeId,
      unit: data.unit ?? '件',
      defaultPrice: skuInputs[0].price ?? data.defaultPrice ?? 0,
      costPrice: data.costPrice ?? null,
      barcode: data.barcode ?? null,
      imageUrl: data.imageUrl ?? null,
      customFields: JSON.stringify(data.customFields ?? {}),
    },
  });

  for (const [i, s] of skuInputs.entries()) {
    const sku = await prisma.sku.create({
      data: {
        productId: product.id,
        code: i === 0 ? code : `${code}-${i + 1}`,
        specValues: JSON.stringify(s.specValues ?? {}),
        specText: buildSpecText(s.specValues ?? {}, skuFields),
        price: s.price ?? 0,
        costPrice: s.costPrice ?? null,
        barcode: s.barcode ?? null,
        imageUrl: s.imageUrl ?? null,
        isDefault: i === 0 ? 1 : 0,
      },
    });
    await prisma.inventory.create({
      data: { productId: product.id, skuId: sku.id, quantity: s.initQuantity ?? 0, minQuantity: s.minQuantity ?? 0 },
    });
    if ((s.initQuantity ?? 0) > 0) {
      await prisma.inventoryRecord.create({
        data: {
          productId: product.id,
          skuId: sku.id,
          type: 'inbound',
          quantity: s.initQuantity,
          beforeQuantity: 0,
          afterQuantity: s.initQuantity,
          reason: '建品初始库存',
          operatorId,
        },
      });
    }
  }
  return product.id;
};

exports.create = async (req, res) => {
  const data = productSchema.parse(req.body);
  try {
    const id = await createProductCore(data, req.user.userId);
    const full = await prisma.product.findUnique({ where: { id }, include: includeFull });
    return created(res, serializeProduct(full));
  } catch (e) {
    if (e.fieldErrors) return fail(res, 400, '字段校验失败', e.fieldErrors);
    throw e;
  }
};

// 批量建品（AI 生成 / 粘贴导入的确认落库）：逐条容错，坏一条不拖垮全部
exports.batchCreate = async (req, res) => {
  const { productTypeId, products } = z
    .object({
      productTypeId: z.number().int(),
      products: z
        .array(
          z.object({
            name: z.string().min(1),
            unit: z.string().default('件'),
            customFields: z.record(z.any()).default({}),
            skus: z.array(skuInputSchema).optional(),
          })
        )
        .min(1)
        .max(100),
    })
    .parse(req.body);

  const createdList = [];
  const failed = [];
  for (const p of products) {
    try {
      // 导入数据常不完整 → 宽松模式（不卡必填），选项值仍会在编辑时校验
      const id = await createProductCore({ ...p, productTypeId }, req.user.userId, { strict: false });
      createdList.push({ id, name: p.name });
    } catch (e) {
      failed.push({ name: p.name, error: e.message });
    }
  }
  return ok(res, { created: createdList, failed }, `成功 ${createdList.length} 个${failed.length ? `，失败 ${failed.length} 个` : ''}`);
};

exports.update = async (req, res) => {
  const id = Number(req.params.id);
  const data = productSchema.omit({ skus: true }).partial().parse(req.body);
  const existing = await prisma.product.findFirst({ where: { id, isDeleted: 0 } });
  if (!existing) throw httpError(404, '商品不存在');

  if (data.productTypeId !== undefined && data.productTypeId !== existing.productTypeId) {
    const ownedType = await prisma.productType.findFirst({ where: { id: data.productTypeId, isDeleted: 0 } }); // 本店归属校验
    if (!ownedType) throw httpError(404, '品类不存在');
  }
  if (data.customFields) {
    const typeId = data.productTypeId ?? existing.productTypeId;
    const errors = await validateFields(typeId, data.customFields, 'product');
    if (errors.length) return fail(res, 400, '商品字段校验失败', errors);
  }

  const { minQuantity, customFields, ...rest } = data;
  await prisma.product.update({
    where: { id },
    data: { ...rest, ...(customFields ? { customFields: JSON.stringify(customFields) } : {}) },
  });
  // defaultPrice 同步到默认规格 —— 只对「无规格单品」生效。
  // 多规格商品的价格在规格编辑器里改；这里再同步会把用户刚在规格里改好的
  // 售价/预警线用表单里的旧值静默覆盖回去（改完保存又变回原样，还查无此事）。
  const skuCount = await prisma.sku.count({ where: { productId: id, status: 1 } });
  if (skuCount <= 1) {
    if (data.defaultPrice !== undefined) {
      await prisma.sku.updateMany({ where: { productId: id, isDefault: 1 }, data: { price: data.defaultPrice } });
    }
    if (minQuantity !== undefined) {
      const def = await prisma.sku.findFirst({ where: { productId: id, isDefault: 1 } });
      if (def) await prisma.inventory.updateMany({ where: { skuId: def.id }, data: { minQuantity } });
    }
  }
  const full = await prisma.product.findUnique({ where: { id }, include: includeFull });
  return ok(res, serializeProduct(full));
};

exports.remove = async (req, res) => {
  const id = Number(req.params.id);
  const owned = await prisma.product.findFirst({ where: { id, isDeleted: 0 } }); // 本店归属校验
  if (!owned) throw httpError(404, '商品不存在');
  await prisma.product.update({ where: { id }, data: { isDeleted: 1 } });
  return ok(res, null, '已删除');
};

// ===== SKU 管理 =====

exports.addSku = async (req, res) => {
  const productId = Number(req.params.id);
  const s = skuInputSchema.parse(req.body);
  const product = await prisma.product.findFirst({ where: { id: productId, isDeleted: 0 }, include: { skus: true } });
  if (!product) throw httpError(404, '商品不存在');
  const skuErrors = await validateFields(product.productTypeId, s.specValues, 'sku');
  if (skuErrors.length) return fail(res, 400, '规格字段校验失败', skuErrors);
  await assertSpecUnique(productId, s.specValues); // 同一规格不许建两遍

  const skuFields = await prisma.fieldDefinition.findMany({ where: { productTypeId: product.productTypeId, scope: 'sku' } });
  const sku = await prisma.sku.create({
    data: {
      productId,
      code: `${product.code}-${product.skus.length + 1}`,
      specValues: JSON.stringify(s.specValues),
      specText: buildSpecText(s.specValues, skuFields),
      imageUrl: s.imageUrl ?? null,
      price: s.price,
      costPrice: s.costPrice ?? null,
      barcode: s.barcode ?? null,
    },
  });
  const initQty = s.initQuantity ?? 0;
  await prisma.inventory.create({
    data: { productId, skuId: sku.id, quantity: initQty, minQuantity: s.minQuantity ?? 0 },
  });
  // 初始库存也要留入库流水（与建商品的初始入库一致，否则加规格进的这批货审计时无痕迹）
  if (initQty > 0) {
    await prisma.inventoryRecord.create({
      data: {
        productId,
        skuId: sku.id,
        type: 'inbound',
        quantity: initQty,
        beforeQuantity: 0,
        afterQuantity: initQty,
        reason: '新增规格初始库存',
        operatorId: req.user.userId,
      },
    });
  }
  return created(res, { ...sku, specValues: s.specValues });
};

exports.updateSku = async (req, res) => {
  const skuId = Number(req.params.skuId);
  const s = skuInputSchema.partial().parse(req.body);
  const sku = await prisma.sku.findUnique({ where: { id: skuId }, include: { product: true } });
  if (!sku) throw httpError(404, '规格不存在');

  const data = {};
  if (s.price !== undefined) data.price = s.price;
  if (s.costPrice !== undefined) data.costPrice = s.costPrice;
  if (s.barcode !== undefined) data.barcode = s.barcode;
  if (s.imageUrl !== undefined) data.imageUrl = s.imageUrl;
  if (s.specValues !== undefined) {
    const skuErrors = await validateFields(sku.product.productTypeId, s.specValues, 'sku');
    if (skuErrors.length) return fail(res, 400, '规格字段校验失败', skuErrors);
    await assertSpecUnique(sku.productId, s.specValues, skuId); // 改规格也要查重
    const skuFields = await prisma.fieldDefinition.findMany({ where: { productTypeId: sku.product.productTypeId, scope: 'sku' } });
    data.specValues = JSON.stringify(s.specValues);
    data.specText = buildSpecText(s.specValues, skuFields);
  }
  const updated = await prisma.sku.update({ where: { id: skuId }, data });
  if (s.minQuantity !== undefined) {
    await prisma.inventory.updateMany({ where: { skuId }, data: { minQuantity: s.minQuantity } });
  }
  return ok(res, { ...updated, specValues: JSON.parse(updated.specValues) });
};

exports.removeSku = async (req, res) => {
  const skuId = Number(req.params.skuId);
  const sku = await prisma.sku.findUnique({ where: { id: skuId }, include: { product: { include: { skus: { where: { status: 1 } } } }, inventory: true } });
  if (!sku) throw httpError(404, '规格不存在');
  if (sku.product.skus.length <= 1) return fail(res, 409, '商品至少保留一个规格');
  if ((sku.inventory?.quantity ?? 0) > 0) return fail(res, 409, `该规格还有 ${sku.inventory.quantity} 件库存，先清空再删`);
  await prisma.sku.update({ where: { id: skuId }, data: { status: 0 } });
  return ok(res, null, '规格已停用');
};

// 扫码/输码识别：优先 SKU 条码/编码 → 商品编码（返回商品 + 命中的 SKU）
exports.lookup = async (req, res) => {
  const { code } = z.object({ code: z.string().min(1) }).parse(req.body);
  const raw = code.startsWith('SM:P:') ? code.slice(5) : code;

  const sku = await prisma.sku.findFirst({
    where: { status: 1, OR: [{ code: raw }, { barcode: raw }], product: { isDeleted: 0 } },
    include: { inventory: true, product: { include: { productType: true } } },
  });
  if (sku) {
    return ok(res, {
      ...serializeProduct({ ...sku.product, skus: [{ ...sku, product: undefined }] }),
      matchedSku: { ...sku, specValues: JSON.parse(sku.specValues), product: undefined },
    });
  }
  const product = await prisma.product.findFirst({
    where: { isDeleted: 0, OR: [{ code: raw }, { barcode: raw }] },
    include: { productType: true, skus: { where: { status: 1 }, include: { inventory: true }, orderBy: [{ isDefault: 'desc' }, { id: 'asc' }] } },
  });
  if (!product) throw httpError(404, '未找到对应商品');
  const sp = serializeProduct(product);
  return ok(res, { ...sp, matchedSku: sp.skus[0] ?? null });
};


// ===== 配方（一级 BOM）：卖成品扣原料 =====
const { z: zz } = require('zod');
exports.getRecipe = async (req, res) => {
  const skuId = Number(req.params.skuId);
  const rows = await prisma.recipe.findMany({ where: { ownerSkuId: skuId } });
  const detailed = await Promise.all(
    rows.map(async (r) => {
      const sku = await prisma.sku.findUnique({ where: { id: r.componentSkuId }, include: { product: true, inventory: true } });
      return {
        componentSkuId: r.componentSkuId,
        qty: r.qty,
        productName: sku?.product?.name ?? '（已删）',
        specText: sku?.specText ?? '',
        unit: sku?.product?.unit ?? '',
        stock: sku?.inventory?.quantity ?? 0,
      };
    })
  );
  return ok(res, detailed);
};

exports.setRecipe = async (req, res) => {
  const skuId = Number(req.params.skuId);
  const { components } = zz
    .object({ components: zz.array(zz.object({ componentSkuId: zz.number().int(), qty: zz.number().positive() })).max(30) })
    .parse(req.body);
  if (components.some((c) => c.componentSkuId === skuId)) throw httpError(400, '配方不能包含自己');
  // 本店归属校验：成品和全部原料 SKU 必须都是本店的（否则可给别店 SKU 配方/扣别店库存）
  const ids = [skuId, ...components.map((c) => c.componentSkuId)];
  const ownedCount = await prisma.sku.count({ where: { id: { in: ids } } });
  if (ownedCount !== new Set(ids).size) throw httpError(404, '规格不存在');
  // 只做一级配方：原料自己不能再是配方成品（多级 BOM 明确不做）
  for (const c of components) {
    const nested = await prisma.recipe.count({ where: { ownerSkuId: c.componentSkuId } });
    if (nested > 0) throw httpError(400, '原料不能又是别的配方成品（只支持一级配方）');
  }
  await prisma.$transaction([
    prisma.recipe.deleteMany({ where: { ownerSkuId: skuId } }),
    ...(components.length
      ? [prisma.recipe.createMany({ data: components.map((c) => ({ ownerSkuId: skuId, componentSkuId: c.componentSkuId, qty: c.qty })) })]
      : []),
  ]);
  return ok(res, { count: components.length }, components.length ? `配方已保存（${components.length} 种原料）` : '配方已清空');
};
