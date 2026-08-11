// 租户感知 Prisma 客户端（多租户隔离核心，2026-08-06）
//
// 机制：auth 中间件把 { storeId } 放进 AsyncLocalStorage，本扩展层对所有业务表自动：
//   - 读（findMany/findFirst/count/aggregate/groupBy）：where 合并 storeId
//   - findUnique：查完后校验归属，不是本店 → 当不存在（findUnique 语法不允许合并 where）
//   - create/createMany：data 注入 storeId；无租户上下文时直接抛错（防止静默落到店1）
//   - updateMany/deleteMany：where 合并 storeId（删号清店因此天然只清本店）
//   - upsert：where 已含唯一键；先用未扩展客户端确认该唯一键没被别店占用，create 侧注入 storeId
//   - update/delete（单条）：不在这里拦——事务内的前置校验读不到事务中新建的行会误判。
//     约定：所有单条 update/delete 必须先经过本店范围内的读（findFirst/findUnique）拿到 id。
//     该约定由 2026-08-06 的全控制器审计保证，新增代码必须遵守。
//
// 无上下文（登录/注册/oauth/种子脚本）时读操作原样放行；写操作除非 ALLOW_NO_TENANT=1 否则拒绝。
// 注册/oauth 建号走 runWithTenant(新店id, ...) 显式给上下文。

const { PrismaClient } = require('@prisma/client');
const { AsyncLocalStorage } = require('async_hooks');

const tenantALS = new AsyncLocalStorage();
const base = new PrismaClient();

// 所有带 storeId 的业务表（与 schema 一一对应；漏配=该表不隔离，加表时必须同步）
const TENANT_MODELS = new Set([
  'User', 'ProductType', 'FieldDefinition', 'Product', 'Sku', 'Inventory', 'InventoryRecord',
  'Customer', 'Supplier', 'PricingRule', 'Order', 'OrderItem', 'PurchaseOrder', 'PurchaseOrderItem',
  'Stocktake', 'StocktakeItem', 'Setting', 'PaymentRecord', 'Income', 'Expense', 'Recipe',
]);

const READ_WHERE_OPS = new Set(['findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy']);
const MANY_WRITE_OPS = new Set(['updateMany', 'deleteMany']);

const lcFirst = (s) => s[0].toLowerCase() + s.slice(1);

const prisma = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!TENANT_MODELS.has(model)) return query(args);
        const ctx = tenantALS.getStore();

        if (!ctx) {
          // 无上下文：读放行（登录前的必要查询），写默认拒绝
          const isWrite = ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'].includes(operation);
          if (isWrite && process.env.ALLOW_NO_TENANT !== '1') {
            throw Object.assign(new Error(`缺少租户上下文，拒绝对 ${model} 的写操作（注册/脚本请用 runWithTenant 或 ALLOW_NO_TENANT=1）`), { status: 500 });
          }
          return query(args);
        }

        const sid = ctx.storeId;
        args = args ?? {};

        if (READ_WHERE_OPS.has(operation) || MANY_WRITE_OPS.has(operation)) {
          args.where = { AND: [args.where ?? {}, { storeId: sid }] };
          return query(args);
        }
        if (operation === 'create') {
          args.data = { storeId: sid, ...args.data };
          return query(args);
        }
        if (operation === 'createMany') {
          args.data = Array.isArray(args.data)
            ? args.data.map((d) => ({ storeId: sid, ...d }))
            : { storeId: sid, ...args.data };
          return query(args);
        }
        if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
          // 调用方带 select 且没选 storeId 时会拿不到归属信息——强制补选，返回前再剥掉，
          // 否则 findUnique+select 会静默绕过归属校验（审计发现的机制级漏洞）
          let stripStoreId = false;
          if (args.select && args.select.storeId === undefined) {
            args.select = { ...args.select, storeId: true };
            stripStoreId = true;
          }
          const row = await query(args);
          if (row && row.storeId !== undefined && row.storeId !== sid) {
            if (operation === 'findUniqueOrThrow') throw Object.assign(new Error('记录不存在'), { status: 404 });
            return null;
          }
          if (row && stripStoreId) delete row.storeId;
          return row;
        }
        if (operation === 'upsert') {
          // 唯一键若已被别的店占用，绝不允许改写。
          // 用 base.findUnique（不是 findFirst）：upsert 的 where 是唯一键语法（可能是复合键），findFirst 不认
          const existing = await base[lcFirst(model)].findUnique({ where: args.where, select: { storeId: true } });
          if (existing && existing.storeId !== sid) {
            throw Object.assign(new Error('记录不存在'), { status: 404 });
          }
          args.create = { storeId: sid, ...args.create };
          return query(args);
        }
        // update / delete 单条：按约定调用方已做本店范围校验，这里放行
        return query(args);
      },
    },
  },
});

/** 在指定店铺上下文里执行（auth 中间件 / 注册建店用） */
const runWithTenant = (storeId, fn) => tenantALS.run({ storeId }, fn);

/** 当前请求的店铺 id（无上下文返回 null；controllers 里给嵌套 create 手动补 storeId 用） */
const getTenantId = () => tenantALS.getStore()?.storeId ?? null;

module.exports = prisma;
module.exports.runWithTenant = runWithTenant;
module.exports.getTenantId = getTenantId;
module.exports.basePrisma = base;
