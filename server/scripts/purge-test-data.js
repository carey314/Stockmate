// 硬删自动化测试产生的软删除残留（App 的 DELETE 是软删，影子行会越积越多）。
// 跑法：cd server && env -u NODE_OPTIONS node scripts/purge-test-data.js
const p = new (require('@prisma/client').PrismaClient)();
(async () => {
  const junk = await p.product.findMany({
    where: { OR: [{ name: { contains: '分页测试品' } }, { name: { contains: '__测试' } }, { code: { startsWith: 'ZTEST' } }] },
    select: { id: true },
  });
  const ids = junk.map((x) => x.id);
  const skus = await p.sku.findMany({ where: { productId: { in: ids } }, select: { id: true } });
  const skuIds = skus.map((s) => s.id);
  await p.recipe.deleteMany({ where: { OR: [{ ownerSkuId: { in: skuIds } }, { componentSkuId: { in: skuIds } }] } });
  await p.inventoryRecord.deleteMany({ where: { productId: { in: ids } } });
  await p.inventory.deleteMany({ where: { skuId: { in: skuIds } } });
  await p.pricingRule.deleteMany({ where: { productId: { in: ids } } });
  await p.sku.deleteMany({ where: { productId: { in: ids } } });
  await p.product.deleteMany({ where: { id: { in: ids } } });
  const types = await p.productType.deleteMany({ where: { name: { contains: '分页测试品类' } } });
  console.log(`硬删测试商品 ${ids.length} 个、测试品类 ${types.count} 个`);
  console.log('剩余商品(含软删):', await p.product.count());
  await p.$disconnect();
})();
