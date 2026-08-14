const { z } = require('zod');
const prisma = require('../config/prisma');
const { getTenantId } = require('../config/prisma');
const { ok, created } = require('../utils/response');
const { httpError, genOrderNo, getWalkInCustomer, isNegativeStockAllowed, deductForSale, money } = require('../utils/biz');

// 销售单：完整单据（明细按 SKU + 折扣 + 实收/欠款 + 结算账户）
const orderSchema = z.object({
  // 不传 = 散客（服务端兜底挂到内置「散客」档案）。
  // 强制选客户会把小店的第一单就卡死——他们绝大多数是一手交钱一手交货。
  customerId: z.number().int().nullish(),
  notes: z.string().nullish(),
  discountRate: z.number().min(0).max(100).nullish(), // 95 = 95折
  discountAmount: z.number().nonnegative().optional(), // 直接给折扣金额（与折扣率二选一，都给以金额为准）
  paidAmount: z.number().nonnegative().optional(), // 已收款（默认=实收全款；少于实收即挂账）
  settlementAccount: z.string().nullish(), // 现金/微信/支付宝/银行卡/挂账
  items: z
    .array(
      z.object({
        skuId: z.number().int().optional(),
        productId: z.number().int().optional(), // 兼容：无 skuId 用默认规格
        quantity: z.number().positive(), // 支持散称 0.5 斤
        unitPrice: z.number().nonnegative(),
      })
    )
    .min(1, '订单至少一件商品'),
});

const resolveSkuWithProduct = async (tx, item) => {
  if (item.skuId) {
    const sku = await tx.sku.findUnique({ where: { id: item.skuId }, include: { product: true, inventory: true } });
    if (!sku || sku.product.isDeleted) throw httpError(404, `规格 ${item.skuId} 不存在`);
    return sku;
  }
  if (item.productId) {
    const sku = await tx.sku.findFirst({
      where: { productId: item.productId, status: 1 },
      orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
      include: { product: true, inventory: true },
    });
    if (!sku) throw httpError(404, `商品 ${item.productId} 无可用规格`);
    return sku;
  }
  throw httpError(400, '明细需提供 skuId 或 productId');
};

exports.create = async (req, res) => {
  const data = orderSchema.parse(req.body);
  const operatorId = req.user.userId;

  const allowNegative = await isNegativeStockAllowed();

  const order = await prisma.$transaction(async (tx) => {
    // 没指定客户 → 挂内置散客；指定了客户 → 本店归属校验（防跨店挂靠+客户资料回显泄露）
    if (data.customerId) {
      const owned = await tx.customer.findFirst({ where: { id: data.customerId, isDeleted: 0 } });
      if (!owned) throw httpError(404, '客户不存在');
    }
    const customerId = data.customerId ?? (await getWalkInCustomer(tx)).id;

    const resolved = [];
    let total = 0;
    for (const item of data.items) {
      const sku = await resolveSkuWithProduct(tx, item);
      total += money(item.quantity * item.unitPrice); // 逐行取整再累加，脏浮点不进总额
      resolved.push({ sku, quantity: item.quantity, unitPrice: item.unitPrice });
    }
    const negatives = []; // 扣库存时收集（含配方原料），落库后提示老板补录

    // 折扣：金额优先；否则按折扣率算
    // 金额优先于折扣率。注意用 == null 判断而不是取真假——
    // 老板显式填「优惠 0 元」就是不优惠，不该被折扣率顶掉
    let discountAmount = money(data.discountAmount ?? 0);
    if (data.discountAmount == null && data.discountRate != null) {
      discountAmount = money((total * (100 - data.discountRate)) / 100);
    }
    const actual = money(Math.max(0, total - discountAmount));
    const paid = data.paidAmount ?? actual; // 默认收全款
    // 散客（不记名）必须当场结清——没名没姓的欠款等于消失，追都没处追。赊账请先选/建客户
    if (!data.customerId && paid < actual - 0.001) {
      throw httpError(400, `散客订单需当场结清（应收 ¥${actual}，实收 ¥${paid}）。要赊账请先选择客户`);
    }

    const orderNo = await genOrderNo(tx);
    const order = await tx.order.create({
      data: {
        orderNo,
        customerId,
        status: 'completed',
        totalAmount: total,
        discountRate: data.discountRate ?? null,
        discountAmount,
        actualAmount: actual,
        paidAmount: paid,
        settlementAccount: data.settlementAccount ?? null,
        notes: data.notes ?? null,
        operatorId,
        items: {
          create: resolved.map((r) => ({
            storeId: getTenantId(), // 嵌套 create 不走扩展层注入，必须显式带
            productId: r.sku.productId,
            skuId: r.sku.id,
            productName: r.sku.product.name,
            specText: r.sku.specText || null,
            quantity: r.quantity,
            unitPrice: r.unitPrice,
            // 锁住卖出那一刻的成本，之后改进价不影响这单的利润
            costSnapshot: r.sku.costPrice ?? r.sku.product.costPrice ?? null,
            subtotal: money(r.quantity * r.unitPrice),
          })),
        },
      },
      include: { items: true, customer: true },
    });

    for (const r of resolved) {
      const neg = await deductForSale(tx, {
        sku: r.sku,
        qty: r.quantity,
        reasonLabel: `销售单 ${orderNo}`,
        relatedOrderId: order.id,
        operatorId,
        allowNegative,
      });
      negatives.push(...neg);
    }
    // 开单收款留流水（资金报表/对账单的数据源）
    if (paid > 0) {
      await tx.paymentRecord.create({
        data: {
          direction: 'in',
          amount: paid,
          account: data.settlementAccount ?? null,
          orderId: order.id,
          customerId,
          note: `开单收款 ${orderNo}`,
          operatorId,
        },
      });
    }
    return { order, negatives };
  });

  const { order: created_, negatives } = order;
  return created(
    res,
    {
      ...created_,
      unpaidAmount: Math.round((created_.actualAmount - created_.paidAmount) * 100) / 100,
      // 卖成负库存的规格，前端要显眼提示老板去补录进货
      negativeStock: negatives,
    },
    negatives.length ? `开单成功，但 ${negatives.length} 个规格库存变成负数，记得补录进货` : '开单成功'
  );
};

exports.list = async (req, res) => {
  const { page = 1, pageSize = 20, customerId, status, startDate, endDate, unpaidOnly, keyword } = req.query;
  const where = {
    ...(customerId ? { customerId: Number(customerId) } : {}),
    ...(status ? { status } : {}),
    // 模糊查询：单号或客户名（Web 列表搜索框 / Cmd+K 全局搜索用）
    ...(keyword ? { OR: [{ orderNo: { contains: keyword } }, { customer: { name: { contains: keyword } } }] } : {}),
    ...(startDate || endDate
      ? {
          createdAt: {
            ...(startDate ? { gte: new Date(startDate) } : {}),
            ...(endDate ? { lte: new Date(`${endDate}T23:59:59`) } : {}),
          },
        }
      : {}),
  };
  // 只看欠款：必须进 where 一起查，不能取完当页再过滤。
  // 原来是 take 之后 filter，等于「在这 20 条里挑欠款的」——
  // total 也是全量数，App 上的欠款合计和条数全是错的。
  if (unpaidOnly === '1') {
    where.status = 'completed';
    // SQLite/Prisma 不支持字段间比较，用原始条件表达 paidAmount < actualAmount
    where.NOT = { paidAmount: { equals: prisma.order.fields.actualAmount } };
  }
  const [total, listRaw] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      include: { customer: { select: { id: true, name: true } }, _count: { select: { items: true } } },
      orderBy: { id: 'desc' },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);
  const list = listRaw.map((o) => ({ ...o, unpaidAmount: Math.round((o.actualAmount - o.paidAmount) * 100) / 100 }));
  return ok(res, {
    list,
    pagination: { page: Number(page), pageSize: Number(pageSize), total, totalPages: Math.ceil(total / Number(pageSize)) },
  });
};

exports.detail = async (req, res) => {
  const id = Number(req.params.id);
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true, customer: true, operator: { select: { id: true, realName: true } } },
  });
  if (!order) throw httpError(404, '订单不存在');
  return ok(res, { ...order, unpaidAmount: Math.round((order.actualAmount - order.paidAmount) * 100) / 100 });
};

// 收款（补收欠款）
exports.receivePayment = async (req, res) => {
  const id = Number(req.params.id);
  const { amount, settlementAccount } = z
    .object({ amount: z.number().positive(), settlementAccount: z.string().nullish() })
    .parse(req.body);
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw httpError(404, '订单不存在');
  const unpaid = order.actualAmount - order.paidAmount;
  if (amount > unpaid + 0.001) throw httpError(400, `收款超出欠款（欠 ¥${unpaid.toFixed(2)}）`);
  const updated = await prisma.order.update({
    where: { id },
    data: {
      paidAmount: order.paidAmount + amount,
      ...(settlementAccount ? { settlementAccount } : {}),
    },
  });
  // 补收欠款留独立流水（有自己的时间戳）
  await prisma.paymentRecord.create({
    data: {
      direction: 'in',
      amount,
      account: settlementAccount ?? order.settlementAccount,
      orderId: order.id,
      customerId: order.customerId,
      note: `收欠款 ${order.orderNo}`,
      operatorId: req.user.userId,
    },
  });
  return ok(res, { ...updated, unpaidAmount: updated.actualAmount - updated.paidAmount }, '已收款');
};

// 销售退货：库存回增 + 应收冲减 + 多收部分自动退款（全程留流水，防超退）
exports.returnItems = async (req, res) => {
  const id = Number(req.params.id);
  const { items, account } = z
    .object({
      items: z.array(z.object({ itemId: z.number().int(), quantity: z.number().positive() })).min(1),
      account: z.string().nullish(), // 退款方式
    })
    .parse(req.body);
  const operatorId = req.user.userId;

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id }, include: { items: true } });
    if (!order) throw httpError(404, '订单不存在');
    if (order.status !== 'completed') throw httpError(400, '只有已完成订单可以退货');

    let returnValue = 0;
    const details = [];
    for (const r of items) {
      const item = order.items.find((x) => x.id === r.itemId);
      if (!item) throw httpError(404, `明细 ${r.itemId} 不属于该订单`);
      const returnable = item.quantity - item.returnedQty;
      if (r.quantity > returnable) {
        throw httpError(400, `「${item.productName}」最多可退 ${returnable} 件（已购${item.quantity}，已退${item.returnedQty}）`);
      }
      returnValue += r.quantity * item.unitPrice;

      // 库存回增 + 流水
      if (item.skuId) {
        let inv = await tx.inventory.findUnique({ where: { skuId: item.skuId } });
        if (!inv) inv = await tx.inventory.create({ data: { productId: item.productId, skuId: item.skuId } });
        await tx.inventory.update({ where: { id: inv.id }, data: { quantity: inv.quantity + r.quantity } });
        await tx.inventoryRecord.create({
          data: {
            productId: item.productId,
            skuId: item.skuId,
            type: 'inbound',
            quantity: r.quantity,
            beforeQuantity: inv.quantity,
            afterQuantity: inv.quantity + r.quantity,
            reason: `销售退货（${order.orderNo}）`,
            relatedOrderId: order.id,
            operatorId,
          },
        });
      }
      await tx.orderItem.update({ where: { id: item.id }, data: { returnedQty: item.returnedQty + r.quantity } });
      details.push({ productName: item.productName, quantity: r.quantity, amount: r.quantity * item.unitPrice });
    }

    returnValue = Math.round(returnValue * 100) / 100;
    // 冲减应收；已收超过新应收的部分退现金
    const newActual = Math.round((order.actualAmount - returnValue) * 100) / 100;
    const refundCash = Math.max(0, Math.round((order.paidAmount - newActual) * 100) / 100);
    const newPaid = Math.round((order.paidAmount - refundCash) * 100) / 100;
    await tx.order.update({ where: { id }, data: { actualAmount: newActual, paidAmount: newPaid } });
    // 退货必须留一条带时间戳的往来记录（account='冲账' 标记非现金，资金流水会排除）。
    // 不留的话：对账单上历史单据金额被直接改小，上个月发给客户的对账单和这个月对不上，
    // 老板说不清"是退货了"还是"账改了"。
    await tx.paymentRecord.create({
      data: {
        direction: 'in', // 冲减客户欠款，方向同收款；金额=全部退货价值
        amount: returnValue,
        account: '冲账',
        orderId: order.id,
        customerId: order.customerId,
        note: `退货冲减 ${order.orderNo}`,
        operatorId,
      },
    });

    if (refundCash > 0) {
      await tx.paymentRecord.create({
        data: {
          direction: 'out',
          amount: refundCash,
          account: account ?? order.settlementAccount,
          orderId: order.id,
          customerId: order.customerId,
          note: `销售退货退款 ${order.orderNo}`,
          operatorId,
        },
      });
    }
    return { returnValue, refundCash, newActual, newPaid, details };
  });

  return ok(res, result, `已退货：冲减应收 ¥${result.returnValue}${result.refundCash > 0 ? `，退款 ¥${result.refundCash}` : ''}`);
};

// 标记打印时间
exports.markPrinted = async (req, res) => {
  const id = Number(req.params.id);
  const owned = await prisma.order.findFirst({ where: { id } }); // 本店归属校验
  if (!owned) throw httpError(404, '订单不存在');
  const updated = await prisma.order.update({ where: { id }, data: { printedAt: new Date() } });
  return ok(res, updated);
};

// 取消订单：回退库存（SKU 维度）
exports.cancel = async (req, res) => {
  const id = Number(req.params.id);
  const operatorId = req.user.userId;

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id }, include: { items: true } });
    if (!order) throw httpError(404, '订单不存在');
    if (order.status !== 'completed') throw httpError(400, '只有已完成订单可以取消');

    for (const item of order.items) {
      if (!item.skuId) continue; // 极老数据兜底
      // 只回退「仍在客户手上」的净数量：已退货部分在退货时就加回过库存，
      // 这里再按原始 quantity 回退会把退货过的货重复入库（先退货再作废时库存虚高）。
      const netQty = item.quantity - (item.returnedQty ?? 0);
      if (netQty <= 0) continue;
      const inv = await tx.inventory.findUnique({ where: { skuId: item.skuId } });
      const before = inv?.quantity ?? 0;
      const after = before + netQty;
      await tx.inventory.update({ where: { skuId: item.skuId }, data: { quantity: after } });
      await tx.inventoryRecord.create({
        data: {
          productId: item.productId,
          skuId: item.skuId,
          type: 'inbound',
          quantity: netQty,
          beforeQuantity: before,
          afterQuantity: after,
          reason: `取消订单 ${order.orderNo} 回退`,
          relatedOrderId: order.id,
          operatorId,
        },
      });
    }
    // 收过钱的单取消：钱必须有去向——生成退款流水，否则资金流水虚高、账实不符
    if (order.paidAmount > 0) {
      await tx.paymentRecord.create({
        data: {
          direction: 'out',
          amount: order.paidAmount,
          account: order.settlementAccount ?? null,
          orderId: order.id,
          customerId: order.customerId,
          note: `取消订单退款 ${order.orderNo}`,
          operatorId,
        },
      });
    }
    return tx.order.update({ where: { id }, data: { status: 'cancelled' } });
  });

  return ok(res, result, `订单已取消，库存已回退${result.paidAmount > 0 ? `，应退款 ¥${result.paidAmount}` : ''}`);
};
