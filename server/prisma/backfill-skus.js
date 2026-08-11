// SKU 迁移回填：给每个没有规格的商品建"默认规格"，把库存/定价/订单明细挂到 SKU 上
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const products = await prisma.product.findMany({ include: { skus: true } });
  let created = 0;
  for (const p of products) {
    let def = p.skus.find((s) => s.isDefault === 1) || p.skus[0];
    if (!def) {
      def = await prisma.sku.create({
        data: {
          productId: p.id,
          code: p.code, // 默认规格沿用商品编码（扫码兼容）
          specValues: '{}',
          specText: '',
          price: p.defaultPrice,
          costPrice: p.costPrice,
          barcode: p.barcode,
          isDefault: 1,
        },
      });
      created++;
    }
    // 库存挂到默认 SKU
    await prisma.inventory.updateMany({ where: { productId: p.id, skuId: null }, data: { skuId: def.id } });
    // 老定价规则挂到默认 SKU
    await prisma.pricingRule.updateMany({ where: { productId: p.id, skuId: null }, data: { skuId: def.id } });
    // 老订单明细/出入库记录挂到默认 SKU
    await prisma.orderItem.updateMany({ where: { productId: p.id, skuId: null }, data: { skuId: def.id } });
    await prisma.inventoryRecord.updateMany({ where: { productId: p.id, skuId: null }, data: { skuId: def.id } });
  }
  console.log(`✓ 回填完成：${products.length} 个商品，新建默认规格 ${created} 个`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
