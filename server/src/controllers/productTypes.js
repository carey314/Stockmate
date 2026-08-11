const { z } = require('zod');
const prisma = require('../config/prisma');
const { getTenantId } = require('../config/prisma');
const { ok, created, fail } = require('../utils/response');
const { httpError, serializeType, serializeField } = require('../utils/biz');

const fieldSchema = z.object({
  key: z.string().min(1).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'key 须为字母开头的英文标识'),
  label: z.string().min(1),
  type: z.enum(['text', 'number', 'select', 'date', 'boolean']).default('text'),
  scope: z.enum(['product', 'sku']).default('product'), // product=商品描述 | sku=规格维度
  options: z.array(z.string()).nullish(),
  unit: z.string().nullish(),
  required: z.boolean().default(false),
  isCore: z.boolean().default(false),
  affectsStock: z.boolean().default(true), // 仅 sku 字段有意义：false=点单口味选项，不产生库存规格
  showInList: z.boolean().default(false), // true=商品列表副标题显示该字段值（药店靠厂家区分同名药）
  sortOrder: z.number().int().default(0),
});

const typeSchema = z.object({
  name: z.string().min(1, '品类名称不能为空'),
  icon: z.string().nullish(),
  description: z.string().nullish(),
  fields: z.array(fieldSchema).default([]),
});

// 品类列表（含字段定义）
exports.list = async (_req, res) => {
  const types = await prisma.productType.findMany({
    where: { isDeleted: 0 },
    include: { fields: { orderBy: { sortOrder: 'asc' } }, _count: { select: { products: true } } },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  return ok(res, types.map(serializeType));
};

exports.detail = async (req, res) => {
  const id = Number(req.params.id);
  const type = await prisma.productType.findFirst({
    where: { id, isDeleted: 0 },
    include: { fields: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!type) throw httpError(404, '品类不存在');
  return ok(res, serializeType(type));
};

// 新建品类（含字段，一次性建）
exports.create = async (req, res) => {
  const data = typeSchema.parse(req.body);
  const type = await prisma.productType.create({
    data: {
      name: data.name,
      icon: data.icon ?? null,
      description: data.description ?? null,
      fields: {
        create: data.fields.map((f, i) => ({
          storeId: getTenantId(), // 嵌套 create 不走扩展层注入，必须显式带
          key: f.key,
          label: f.label,
          type: f.type,
          scope: f.scope,
          options: f.options ? JSON.stringify(f.options) : null,
          unit: f.unit ?? null,
          required: f.required ? 1 : 0,
          affectsStock: f.affectsStock === false ? 0 : 1,
          showInList: f.showInList === true ? 1 : 0,
          isCore: f.isCore ? 1 : 0,
          sortOrder: f.sortOrder || i,
        })),
      },
    },
    include: { fields: { orderBy: { sortOrder: 'asc' } } },
  });
  return created(res, serializeType(type));
};

// 更新品类基本信息
exports.update = async (req, res) => {
  const id = Number(req.params.id);
  const data = typeSchema.omit({ fields: true }).partial().parse(req.body);
  const owned = await prisma.productType.findFirst({ where: { id, isDeleted: 0 } }); // 本店归属校验
  if (!owned) throw httpError(404, '品类不存在');
  const type = await prisma.productType.update({ where: { id }, data });
  return ok(res, serializeType(type));
};

// 删除品类：有商品则禁止硬删（用户已确认的策略）
exports.remove = async (req, res) => {
  const id = Number(req.params.id);
  const owned = await prisma.productType.findFirst({ where: { id, isDeleted: 0 } }); // 本店归属校验
  if (!owned) throw httpError(404, '品类不存在');
  const count = await prisma.product.count({ where: { productTypeId: id, isDeleted: 0 } });
  if (count > 0) return fail(res, 409, `该品类下还有 ${count} 个商品，不能删除（可先停用）`);
  await prisma.productType.update({ where: { id }, data: { isDeleted: 1 } });
  return ok(res, null, '已删除');
};

// ===== 字段管理 =====

exports.addField = async (req, res) => {
  const productTypeId = Number(req.params.id);
  const f = fieldSchema.parse(req.body);
  const owned = await prisma.productType.findFirst({ where: { id: productTypeId, isDeleted: 0 } }); // 本店归属校验
  if (!owned) throw httpError(404, '品类不存在');
  const field = await prisma.fieldDefinition.create({
    data: {
      productTypeId,
      key: f.key,
      label: f.label,
      type: f.type,
      scope: f.scope,
      options: f.options ? JSON.stringify(f.options) : null,
      unit: f.unit ?? null,
      required: f.required ? 1 : 0,
      // 必须显式持久化：漏了会走 DB 默认 affectsStock=1，把"温度/糖度"这类不占库存的
      // 规格维度重置成产生库存（编辑品类=删旧全量重建，每次都会踩）
      affectsStock: f.affectsStock === false ? 0 : 1,
      showInList: f.showInList === true ? 1 : 0,
      isCore: f.isCore ? 1 : 0,
      sortOrder: f.sortOrder,
    },
  });
  return created(res, serializeField(field));
};

exports.updateField = async (req, res) => {
  const fieldId = Number(req.params.fieldId);
  const f = fieldSchema.partial().parse(req.body);
  const data = { ...f };
  if (f.options !== undefined) data.options = f.options ? JSON.stringify(f.options) : null;
  if (f.required !== undefined) data.required = f.required ? 1 : 0;
  if (f.isCore !== undefined) data.isCore = f.isCore ? 1 : 0;
  // boolean → Int(0/1) 归一，否则写进 Int 列行为不确定
  if (f.affectsStock !== undefined) data.affectsStock = f.affectsStock ? 1 : 0;
  if (f.showInList !== undefined) data.showInList = f.showInList ? 1 : 0;
  const owned = await prisma.fieldDefinition.findFirst({ where: { id: fieldId } }); // 本店归属校验
  if (!owned) throw httpError(404, '字段不存在');
  const field = await prisma.fieldDefinition.update({ where: { id: fieldId }, data });
  return ok(res, serializeField(field));
};

exports.removeField = async (req, res) => {
  const fieldId = Number(req.params.fieldId);
  const owned = await prisma.fieldDefinition.findFirst({ where: { id: fieldId } }); // 本店归属校验
  if (!owned) throw httpError(404, '字段不存在');
  await prisma.fieldDefinition.delete({ where: { id: fieldId } });
  return ok(res, null, '字段已删除');
};
