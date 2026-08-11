-- CreateTable
CREATE TABLE "Sku" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "specValues" TEXT NOT NULL DEFAULT '{}',
    "specText" TEXT NOT NULL DEFAULT '',
    "price" REAL NOT NULL DEFAULT 0,
    "costPrice" REAL,
    "barcode" TEXT,
    "isDefault" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Sku_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "isDeleted" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderNo" TEXT NOT NULL,
    "supplierId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "totalAmount" REAL NOT NULL DEFAULT 0,
    "discountRate" REAL,
    "discountAmount" REAL NOT NULL DEFAULT 0,
    "actualAmount" REAL NOT NULL DEFAULT 0,
    "paidAmount" REAL NOT NULL DEFAULT 0,
    "settlementAccount" TEXT,
    "notes" TEXT,
    "printedAt" DATETIME,
    "operatorId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrder_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "purchaseOrderId" INTEGER NOT NULL,
    "skuId" INTEGER NOT NULL,
    "productName" TEXT NOT NULL,
    "specText" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" REAL NOT NULL,
    "subtotal" REAL NOT NULL,
    CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrderItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FieldDefinition" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productTypeId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "scope" TEXT NOT NULL DEFAULT 'product',
    "options" TEXT,
    "unit" TEXT,
    "required" INTEGER NOT NULL DEFAULT 0,
    "isCore" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "FieldDefinition_productTypeId_fkey" FOREIGN KEY ("productTypeId") REFERENCES "ProductType" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_FieldDefinition" ("id", "isCore", "key", "label", "options", "productTypeId", "required", "sortOrder", "type", "unit") SELECT "id", "isCore", "key", "label", "options", "productTypeId", "required", "sortOrder", "type", "unit" FROM "FieldDefinition";
DROP TABLE "FieldDefinition";
ALTER TABLE "new_FieldDefinition" RENAME TO "FieldDefinition";
CREATE INDEX "FieldDefinition_productTypeId_idx" ON "FieldDefinition"("productTypeId");
CREATE UNIQUE INDEX "FieldDefinition_productTypeId_key_key" ON "FieldDefinition"("productTypeId", "key");
CREATE TABLE "new_Inventory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "skuId" INTEGER,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "minQuantity" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Inventory_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Inventory" ("id", "minQuantity", "productId", "quantity", "updatedAt") SELECT "id", "minQuantity", "productId", "quantity", "updatedAt" FROM "Inventory";
DROP TABLE "Inventory";
ALTER TABLE "new_Inventory" RENAME TO "Inventory";
CREATE UNIQUE INDEX "Inventory_skuId_key" ON "Inventory"("skuId");
CREATE INDEX "Inventory_productId_idx" ON "Inventory"("productId");
CREATE TABLE "new_InventoryRecord" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "skuId" INTEGER,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "beforeQuantity" INTEGER NOT NULL,
    "afterQuantity" INTEGER NOT NULL,
    "reason" TEXT,
    "relatedOrderId" INTEGER,
    "relatedPurchaseOrderId" INTEGER,
    "operatorId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryRecord_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryRecord_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InventoryRecord_relatedOrderId_fkey" FOREIGN KEY ("relatedOrderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InventoryRecord_relatedPurchaseOrderId_fkey" FOREIGN KEY ("relatedPurchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InventoryRecord_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_InventoryRecord" ("afterQuantity", "beforeQuantity", "createdAt", "id", "operatorId", "productId", "quantity", "reason", "relatedOrderId", "type") SELECT "afterQuantity", "beforeQuantity", "createdAt", "id", "operatorId", "productId", "quantity", "reason", "relatedOrderId", "type" FROM "InventoryRecord";
DROP TABLE "InventoryRecord";
ALTER TABLE "new_InventoryRecord" RENAME TO "InventoryRecord";
CREATE INDEX "InventoryRecord_productId_idx" ON "InventoryRecord"("productId");
CREATE INDEX "InventoryRecord_skuId_idx" ON "InventoryRecord"("skuId");
CREATE INDEX "InventoryRecord_type_idx" ON "InventoryRecord"("type");
CREATE INDEX "InventoryRecord_createdAt_idx" ON "InventoryRecord"("createdAt");
CREATE TABLE "new_Order" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderNo" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "totalAmount" REAL NOT NULL DEFAULT 0,
    "discountRate" REAL,
    "discountAmount" REAL NOT NULL DEFAULT 0,
    "actualAmount" REAL NOT NULL DEFAULT 0,
    "paidAmount" REAL NOT NULL DEFAULT 0,
    "settlementAccount" TEXT,
    "notes" TEXT,
    "printedAt" DATETIME,
    "operatorId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Order" ("actualAmount", "createdAt", "customerId", "id", "notes", "operatorId", "orderNo", "status", "totalAmount", "updatedAt") SELECT "actualAmount", "createdAt", "customerId", "id", "notes", "operatorId", "orderNo", "status", "totalAmount", "updatedAt" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_orderNo_key" ON "Order"("orderNo");
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");
CREATE INDEX "Order_status_idx" ON "Order"("status");
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");
CREATE TABLE "new_OrderItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "skuId" INTEGER,
    "productName" TEXT NOT NULL,
    "specText" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" REAL NOT NULL,
    "subtotal" REAL NOT NULL,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_OrderItem" ("id", "orderId", "productId", "productName", "quantity", "subtotal", "unitPrice") SELECT "id", "orderId", "productId", "productName", "quantity", "subtotal", "unitPrice" FROM "OrderItem";
DROP TABLE "OrderItem";
ALTER TABLE "new_OrderItem" RENAME TO "OrderItem";
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");
CREATE TABLE "new_PricingRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "skuId" INTEGER,
    "customerId" INTEGER NOT NULL,
    "price" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PricingRule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PricingRule_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PricingRule_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PricingRule" ("createdAt", "customerId", "id", "price", "productId", "updatedAt") SELECT "createdAt", "customerId", "id", "price", "productId", "updatedAt" FROM "PricingRule";
DROP TABLE "PricingRule";
ALTER TABLE "new_PricingRule" RENAME TO "PricingRule";
CREATE INDEX "PricingRule_customerId_idx" ON "PricingRule"("customerId");
CREATE UNIQUE INDEX "PricingRule_skuId_customerId_key" ON "PricingRule"("skuId", "customerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Sku_code_key" ON "Sku"("code");

-- CreateIndex
CREATE INDEX "Sku_productId_idx" ON "Sku"("productId");

-- CreateIndex
CREATE INDEX "Sku_barcode_idx" ON "Sku"("barcode");

-- CreateIndex
CREATE INDEX "Supplier_name_idx" ON "Supplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_orderNo_key" ON "PurchaseOrder"("orderNo");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_createdAt_idx" ON "PurchaseOrder"("createdAt");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_purchaseOrderId_idx" ON "PurchaseOrderItem"("purchaseOrderId");
