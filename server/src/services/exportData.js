const { basePrisma, getTenantId } = require('../config/prisma');

// Export known business settings only. New settings need an explicit sensitivity review.
const BUSINESS_SETTING_KEYS = ['shopName', 'mainTypeId', 'allowNegativeStock'];
const TABLES = [
  ['productType', '品类', 'ProductType'],
  ['fieldDefinition', '字段定义', 'FieldDefinition'],
  ['product', '商品', 'Product'],
  ['sku', '规格', 'Sku'],
  ['inventory', '库存', 'Inventory'],
  ['customer', '客户', 'Customer'],
  ['supplier', '供应商', 'Supplier'],
  ['order', '销售单', 'Order'],
  ['orderItem', '销售明细', 'OrderItem'],
  ['purchaseOrder', '进货单', 'PurchaseOrder'],
  ['purchaseOrderItem', '进货明细', 'PurchaseOrderItem'],
  ['income', '收入', 'Income'],
  ['expense', '支出', 'Expense'],
  ['paymentRecord', '收付款流水', 'PaymentRecord'],
  ['inventoryRecord', '出入库流水', 'InventoryRecord'],
  ['pricingRule', '专属价', 'PricingRule'],
  ['recipe', '配方', 'Recipe'],
  ['stocktake', '盘点单', 'Stocktake'],
  ['stocktakeItem', '盘点明细', 'StocktakeItem'],
  ['tradeEvent', '交易事件', 'TradeEvent'],
  ['entryConfirmation', '录入确认', 'EntryConfirmation'],
  ['aiUsage', 'AI用量', 'AiUsage'],
];
const error = (status, message) => Object.assign(new Error(message), { status });

/**
 * Authenticated administrator export. Call with req.user inside auth's tenant context.
 * Uses explicit store predicates even for models outside the tenant Prisma extension.
 * The file is a readable business-data export, not an import/payment credential bundle.
 */
async function exportStoreData({ userId, storeId } = {}) {
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(storeId) || storeId <= 0 || getTenantId() !== storeId) {
    throw error(403, '缺少有效店铺导出范围');
  }
  return basePrisma.$transaction(async tx => {
    const user = await tx.user.findFirst({
      where: { id: userId, storeId, status: 1 },
      select: { role: true },
    });
    if (!user) throw error(401, '账号已注销或被停用');
    if (user.role !== 'admin') throw error(403, '无权限（仅管理员）');
    const store = await tx.store.findUnique({ where: { id: storeId } });
    if (!store) throw error(404, '店铺不存在');

    const data = {};
    const tables = [];
    for (const [delegate, key, model] of TABLES) {
      data[key] = await tx[delegate].findMany({ where: { storeId }, orderBy: { id: 'asc' } });
      tables.push({ model, key, count: data[key].length });
    }
    // Assemble from independently scoped rows, never unfiltered relation includes.
    // Keep flat detail lists too: even malformed historical references remain readable.
    for (const [parents, children, foreignKey, nestedKey] of [
      ['品类', '字段定义', 'productTypeId', 'fields'],
      ['销售单', '销售明细', 'orderId', 'items'],
      ['进货单', '进货明细', 'purchaseOrderId', 'items'],
      ['盘点单', '盘点明细', 'stocktakeId', 'items'],
    ]) {
      const groups = new Map();
      for (const child of data[children]) {
        const id = child[foreignKey];
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id).push(child);
      }
      data[parents] = data[parents].map(row => ({ ...row, [nestedKey]: groups.get(row.id) || [] }));
    }

    data.店铺设置 = await tx.setting.findMany({ where: { storeId, key: { in: BUSINESS_SETTING_KEYS } }, orderBy: { key: 'asc' } });
    const omittedSettings = await tx.setting.findMany({ where: { storeId, key: { notIn: BUSINESS_SETTING_KEYS } }, select: { key: true }, orderBy: { key: 'asc' } });
    data.员工 = await tx.user.findMany({
      where: { storeId }, orderBy: { id: 'asc' },
      select: { id: true, storeId: true, realName: true, role: true, status: true, createdAt: true, updatedAt: true },
    });
    data.权益状态 = await tx.entitlement.findMany({
      where: { storeId }, orderBy: { id: 'asc' },
      select: { id: true, storeId: true, plan: true, source: true, status: true, startedAt: true, expiresAt: true, createdAt: true, updatedAt: true },
    });
    data.店铺 = [store];
    data.本人手机号绑定 = await tx.phoneIdentity.findMany({ where: { userId, user: { storeId } }, select: { userId: true, phone: true, verifiedAt: true } });
    tables.push({ model: 'PhoneIdentity', key: '本人手机号绑定', count: data.本人手机号绑定.length });
    for (const [model, key] of [['Setting', '店铺设置'], ['User', '员工'], ['Entitlement', '权益状态'], ['Store', '店铺']]) {
      tables.push({ model, key, count: data[key].length });
    }
    return {
      exportedAt: new Date().toISOString(),
      version: 'stockmate-export-v2',
      manifest: {
        restorable: false,
        scopedStore: { id: store.id, name: store.name },
        consistency: 'single-serializable-read-transaction',
        tables,
        notes: [
          '经营数据导出；当前未实现导入恢复，不是可恢复备份。',
          '保留原始ID、软删除记录、金额、空值及交易事件；不重算历史账务。',
          '字段及单据明细同时提供独立清单与旧格式嵌套副本，阅读汇总时不要重复计数。',
          '录入确认是原始幂等业务记录，保留requestKey/contentHash/response，不代表可重放或导入。',
          '权益仅为库内脱敏状态快照，不授予权益，不能用来恢复购买。',
        ],
        omissions: [
          { model: 'User', fields: ['passwordHash', 'username', 'phone'], reason: '仅导出员工显示名及业务经办人ID映射，不导出登录凭证或个人联系资料。' },
          { model: 'AuthIdentity', reason: '第三方登录身份及openId不属于经营数据。' },
          { model: 'PhoneIdentity', reason: '仅包含导出请求者本人的可信号码及验证时间，不导出员工或其他用户的手机号身份。' },
          { model: 'SmsChallenge', reason: '短信验证挑战、注册票据和尝试记录不导出。' },
          { model: 'SmsReauth', reason: '敏感身份复核挑战与授权不导出。' },
          { model: 'SmsRateBucket', reason: '防滥用限流桶不属于个人经营数据，不导出。' },
          { model: 'WebLoginChallenge', reason: '登录挑战及nonce不导出。' },
          { model: 'WebLoginCode', reason: '登录码、身份标识及其哈希不导出。' },
          { model: 'AppleNotification', reason: '支付通知及交易标识不导出。' },
          { model: 'Entitlement', fields: ['externalId', 'appleTransactionId', 'appleProductId', 'appleEnvironment', 'applePurchaseAt', 'appleVerifiedAt', 'appleRevokedAt', 'note'], reason: '仅保留权益状态字段，排除支付凭证与验证资料。' },
          { model: 'Setting', keys: omittedSettings.map(row => row.key), reason: '仅导出已实现经营配置白名单；未知或敏感设置值不导出。' },
          { model: 'ClientLog', reason: '全局运维日志不属于店铺经营数据。' },
          { resource: 'uploads', reason: '保留商品图片URL，不打包图片文件。' },
          { resource: 'server-secrets', reason: '环境变量、JWT、登录码、Apple签名和密钥不导出。' },
        ],
      },
      数据: data,
    };
  }, { isolationLevel: 'Serializable', timeout: 30000 });
}

module.exports = { exportStoreData };
