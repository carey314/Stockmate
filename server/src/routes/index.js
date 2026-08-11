const { Router } = require('express');
const { auth, adminOnly } = require('../middlewares/auth');
const { authLimiter, aiLimiter } = require('../middlewares/rateLimit');
const { aiMeter } = require('../middlewares/aiMeter');
const { wrap } = require('../utils/response');

const authCtl = require('../controllers/auth');
const typesCtl = require('../controllers/productTypes');
const aiCtl = require('../controllers/ai');
const aiParseCtl = require('../controllers/aiParse');
const expensesCtl = require('../controllers/expenses');
const suppliersCtl = require('../controllers/suppliers');
const incomesCtl = require('../controllers/incomes');
const systemCtl = require('../controllers/system');
const stocktakesCtl = require('../controllers/stocktakes');
const poCtl = require('../controllers/purchaseOrders');
const productsCtl = require('../controllers/products');
const inventoryCtl = require('../controllers/inventory');
const customersCtl = require('../controllers/customers');
const pricingCtl = require('../controllers/pricing');
const ordersCtl = require('../controllers/orders');
const statsCtl = require('../controllers/stats');
const reportsCtl = require('../controllers/reports');

const r = Router();

// 图片上传（商品图）
const multer = require('multer');
const path = require('path');
const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '../../uploads'),
    filename: (_req, file, cb) => cb(null, `img_${Date.now()}_${Math.round(Math.random() * 1e6)}${path.extname(file.originalname) || '.jpg'}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /image\/(jpeg|png|webp|heic|heif)/.test(file.mimetype)),
});
r.post('/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ code: 400, message: '没有收到图片（仅支持 jpg/png/webp/heic，≤8MB）' });
  res.json({ code: 200, message: 'ok', data: { url: `/uploads/${req.file.filename}` } });
});

// 认证
r.post('/client-logs', wrap(require('../controllers/clientLog').report)); // 崩溃上报(无需登录)
r.post('/auth/login', authLimiter, wrap(authCtl.login));
r.post('/auth/register', authLimiter, wrap(authCtl.register)); // 用户名密码注册(注册即登录)
r.post('/auth/oauth', authLimiter, wrap(authCtl.oauthLogin)); // 平台账号登录(apple已实现/huawei/wechat待接)
r.get('/auth/profile', auth, wrap(authCtl.profile));
r.get('/me/entitlement', auth, wrap(require('../controllers/entitlement').mine)); // 当前权益+本月AI用量
r.put('/auth/profile', auth, wrap(authCtl.updateProfile)); // 改店名/手机
r.put('/auth/password', auth, wrap(authCtl.changePassword));
r.post('/auth/delete-account', auth, wrap(authCtl.deleteAccount)); // 删除账号(App Store 5.1.1v)
r.get('/export/all', auth, adminOnly, wrap(authCtl.exportAll)); // 全量数据导出(仅老板)

// 品类 + 字段（核心差异化）
r.get('/product-types', auth, wrap(typesCtl.list));
r.get('/product-types/:id', auth, wrap(typesCtl.detail));
r.post('/product-types', auth, wrap(typesCtl.create));
r.put('/product-types/:id', auth, wrap(typesCtl.update));
r.delete('/product-types/:id', auth, adminOnly, wrap(typesCtl.remove));
r.post('/product-types/:id/fields', auth, wrap(typesCtl.addField));
r.put('/product-types/:id/fields/:fieldId', auth, wrap(typesCtl.updateField));
r.delete('/product-types/:id/fields/:fieldId', auth, wrap(typesCtl.removeField));

// AI
r.post('/ai/generate-fields', auth, aiLimiter, aiMeter('generate-fields'), wrap(aiCtl.generateFields)); // 两层字段(fields+specs)
r.post('/ai/generate-products', auth, aiLimiter, aiMeter('generate-products'), wrap(aiCtl.generateProducts)); // 按品类生成商品建议
r.post('/ai/import-products', auth, aiLimiter, aiMeter('import-products'), wrap(aiCtl.importProducts)); // 粘贴任意表格文字→商品清单草案
r.post('/ai/ask', auth, adminOnly, aiLimiter, aiMeter('ask'), wrap(aiCtl.ask)); // AI问生意(经营快照含利润/欠款,仅老板)
r.post('/ai/parse-entry', auth, aiLimiter, aiMeter('parse-entry'), wrap(aiParseCtl.parseEntry)); // 口述→结构化草案
r.post('/ai/confirm-entry', auth, aiLimiter, aiMeter('confirm-entry'), wrap(aiParseCtl.confirmEntry)); // 确认落库

// 收入流水（日结营业额等）
r.get('/incomes', auth, wrap(incomesCtl.list));
r.post('/incomes', auth, wrap(incomesCtl.create));
r.delete('/incomes/:id', auth, wrap(incomesCtl.remove));

// 经营支出
r.get('/expenses', auth, wrap(expensesCtl.list));
r.post('/expenses', auth, wrap(expensesCtl.create));
r.delete('/expenses/:id', auth, wrap(expensesCtl.remove));

// 商品
r.get('/products', auth, wrap(productsCtl.list));
r.get('/products/:id', auth, wrap(productsCtl.detail));
r.post('/products', auth, wrap(productsCtl.create));
r.post('/products/batch', auth, wrap(productsCtl.batchCreate)); // 批量建品(AI生成/粘贴导入)
r.put('/products/:id', auth, wrap(productsCtl.update));
r.delete('/products/:id', auth, adminOnly, wrap(productsCtl.remove));
r.post('/products/lookup', auth, wrap(productsCtl.lookup)); // 扫码识别(SKU优先)
r.post('/products/:id/skus', auth, wrap(productsCtl.addSku));
r.put('/skus/:skuId', auth, wrap(productsCtl.updateSku));
r.delete('/skus/:skuId', auth, adminOnly, wrap(productsCtl.removeSku));
r.get('/skus/:skuId/recipe', auth, wrap(productsCtl.getRecipe)); // 配方(一级BOM)
r.put('/skus/:skuId/recipe', auth, wrap(productsCtl.setRecipe));

// 供应商
r.get('/suppliers', auth, wrap(suppliersCtl.list));
r.get('/suppliers/:id', auth, wrap(suppliersCtl.detail));
r.post('/suppliers', auth, wrap(suppliersCtl.create));
r.put('/suppliers/:id', auth, wrap(suppliersCtl.update));
r.delete('/suppliers/:id', auth, wrap(suppliersCtl.remove));

// 进货单
r.get('/purchase-orders', auth, wrap(poCtl.list));
r.get('/purchase-orders/:id', auth, wrap(poCtl.detail));
r.post('/purchase-orders', auth, wrap(poCtl.create));
r.post('/purchase-orders/:id/pay', auth, wrap(poCtl.pay));
r.post('/purchase-orders/:id/return', auth, wrap(poCtl.returnItems)); // 进货退货
r.put('/purchase-orders/:id/printed', auth, wrap(poCtl.markPrinted));
r.put('/purchase-orders/:id/cancel', auth, wrap(poCtl.cancel));

// 库存
r.get('/inventory', auth, wrap(inventoryCtl.list));
r.get('/inventory/alerts', auth, wrap(inventoryCtl.alerts));
r.get('/inventory/records', auth, wrap(inventoryCtl.records));
r.post('/inventory/inbound', auth, wrap(inventoryCtl.inbound));
r.post('/inventory/outbound', auth, wrap(inventoryCtl.outbound));
r.post('/inventory/adjust', auth, wrap(inventoryCtl.adjust)); // 单品纠错直接设数

// 盘点单（PD）：提交即完成，盘盈亏自动落库存
r.get('/stocktakes', auth, wrap(stocktakesCtl.list));
r.get('/stocktakes/:id', auth, wrap(stocktakesCtl.detail));
r.post('/stocktakes', auth, wrap(stocktakesCtl.create));

// 客户
r.get('/customers', auth, wrap(customersCtl.list));
r.get('/customers/:id', auth, wrap(customersCtl.detail));
r.post('/customers', auth, wrap(customersCtl.create));
r.put('/customers/:id', auth, wrap(customersCtl.update));
r.delete('/customers/:id', auth, wrap(customersCtl.remove));
r.get('/customers/:id/prices', auth, wrap(customersCtl.prices));
r.get('/customers/:id/frequent', auth, wrap(customersCtl.frequent)); // 该客户常买(复制下单)

// 定价
r.get('/pricing', auth, wrap(pricingCtl.list));
r.get('/pricing/resolve', auth, wrap(pricingCtl.resolve));
r.post('/pricing', auth, wrap(pricingCtl.upsert));
r.delete('/pricing/:id', auth, wrap(pricingCtl.remove));

// 订单
r.get('/orders', auth, wrap(ordersCtl.list));
r.get('/orders/:id', auth, wrap(ordersCtl.detail));
r.post('/orders', auth, wrap(ordersCtl.create));
r.post('/orders/:id/receive-payment', auth, wrap(ordersCtl.receivePayment)); // 收欠款
r.post('/orders/:id/return', auth, wrap(ordersCtl.returnItems)); // 销售退货
r.put('/orders/:id/printed', auth, wrap(ordersCtl.markPrinted));
r.put('/orders/:id/cancel', auth, wrap(ordersCtl.cancel));

// 员工管理 + 店铺设置（仅老板）
r.get('/system/users', auth, adminOnly, wrap(systemCtl.listUsers));
r.post('/system/users', auth, adminOnly, wrap(systemCtl.createStaff));
r.put('/system/users/:id/toggle', auth, adminOnly, wrap(systemCtl.toggleUser));
r.put('/system/users/:id/password', auth, adminOnly, wrap(systemCtl.resetPassword));
r.get('/settings/shop-name', auth, wrap(systemCtl.getShopName));
r.put('/settings/shop-name', auth, adminOnly, wrap(systemCtl.setShopName));
r.put('/settings/main-type', auth, adminOnly, wrap(systemCtl.setMainType)); // 主营品类(全App默认)

// 统计
r.get('/stats/overview', auth, wrap(statsCtl.overview));
r.get('/stats/sales', auth, wrap(statsCtl.sales));

// 报表中心
r.get('/reports/profit', auth, adminOnly, wrap(reportsCtl.profit)); // 经营利润(仅老板)
r.get('/reports/sales-by-product', auth, wrap(reportsCtl.salesByProduct)); // 销售统计(按商品)
r.get('/reports/inventory', auth, wrap(reportsCtl.inventory)); // 库存统计
r.get('/reports/cashflow', auth, adminOnly, wrap(reportsCtl.cashflow)); // 资金流水(仅老板)
r.get('/reports/customer-statement', auth, wrap(reportsCtl.customerStatement)); // 客户对账单
r.get('/reports/staff-performance', auth, adminOnly, wrap(reportsCtl.staffPerformance)); // 员工业绩(仅老板)
r.get('/reports/purchase-stats', auth, wrap(reportsCtl.purchaseStats)); // 进货统计
r.get('/reports/supplier-statement', auth, wrap(reportsCtl.supplierStatement)); // 供应商对账单

module.exports = r;
