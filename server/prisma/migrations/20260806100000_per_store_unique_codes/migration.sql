-- DropIndex
DROP INDEX "Order_orderNo_key";

-- DropIndex
DROP INDEX "Product_code_key";

-- DropIndex
DROP INDEX "PurchaseOrder_orderNo_key";

-- DropIndex
DROP INDEX "Sku_code_key";

-- DropIndex
DROP INDEX "Stocktake_orderNo_key";

-- CreateIndex
CREATE UNIQUE INDEX "Order_storeId_orderNo_key" ON "Order"("storeId", "orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "Product_storeId_code_key" ON "Product"("storeId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_storeId_orderNo_key" ON "PurchaseOrder"("storeId", "orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "Sku_storeId_code_key" ON "Sku"("storeId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Stocktake_storeId_orderNo_key" ON "Stocktake"("storeId", "orderNo");

