-- CreateTable
CREATE TABLE "Store" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Customer" (
    "storeId" INTEGER NOT NULL DEFAULT 1,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "productTypeId" INTEGER,
    "isDeleted" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Customer" ("address", "contactPerson", "createdAt", "id", "isDeleted", "name", "notes", "phone", "productTypeId", "updatedAt") SELECT "address", "contactPerson", "createdAt", "id", "isDeleted", "name", "notes", "phone", "productTypeId", "updatedAt" FROM "Customer";
DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";
CREATE INDEX "Customer_name_idx" ON "Customer"("name");
CREATE INDEX "Customer_storeId_idx" ON "Customer"("storeId");
CREATE TABLE "new_Expense" (
    "storeId" INTEGER NOT NULL DEFAULT 1,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "category" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "note" TEXT,
    "expenseDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operatorId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Expense" ("amount", "category", "createdAt", "expenseDate", "id", "note", "operatorId") SELECT "amount", "category", "createdAt", "expenseDate", "id", "note", "operatorId" FROM "Expense";
DROP TABLE "Expense";
ALTER TABLE "new_Expense" RENAME TO "Expense";
CREATE INDEX "Expense_expenseDate_idx" ON "Expense"("expenseDate");
CREATE INDEX "Expense_category_idx" ON "Expense"("category");
CREATE INDEX "Expense_storeId_idx" ON "Expense"("storeId");
CREATE TABLE "new_FieldDefinition" (
    "storeId" INTEGER NOT NULL DEFAULT 1,
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
    "affectsStock" INTEGER NOT NULL DEFAULT 1,
    "showInList" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "FieldDefinition_productTypeId_fkey" FOREIGN KEY ("productTypeId") REFERENCES "ProductType" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_FieldDefinition" ("affectsStock", "id", "isCore", "key", "label", "options", "productTypeId", "required", "scope", "showInList", "sortOrder", "type", "unit") SELECT "affectsStock", "id", "isCore", "key", "label", "options", "productTypeId", "required", "scope", "showInList", "sortOrder", "type", "unit" FROM "FieldDefinition";
DROP TABLE "FieldDefinition";
ALTER TABLE "new_FieldDefinition" RENAME TO "FieldDefinition";
CREATE INDEX "FieldDefinition_productTypeId_idx" ON "FieldDefinition"("productTypeId");
CREATE INDEX "FieldDefinition_storeId_idx" ON "FieldDefinition"("storeId");
CREATE UNIQUE INDEX "FieldDefinition_productTypeId_key_key" ON "FieldDefinition"("productTypeId", "key");
CREATE TABLE "new_Income" (
    "storeId" INTEGER NOT NULL DEFAULT 1,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "note" TEXT,
    "incomeDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operatorId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Income" ("amount", "createdAt", "id", "incomeDate", "note", "operatorId", "source") SELECT "amount", "createdAt", "id", "incomeDate", "note", "operatorId", "source" FROM "Income";
DROP TABLE "Income";
ALTER TABLE "new_Income" RENAME TO "Income";
CREATE INDEX "Income_incomeDate_idx" ON "Income"("incomeDate");
CREATE INDEX "Income_storeId_idx" ON "Income"("storeId");
CREATE TABLE "new_Inventory" (
    "storeId" INTEGER NOT NULL DEFAULT 1,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "skuId" INTEGER,
    "quantity" REAL NOT NULL DEFAULT 0,
    "minQuantity" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Inventory_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Inventory" ("id", "minQuantity", "productId", "quantity", "skuId", "updatedAt") SELECT "id", "minQuantity", "productId", "quantity", "skuId", "updatedAt" FROM "Inventory";
DROP TABLE "Inventory";
ALTER TABLE "new_Inventory" RENAME TO "Inventory";
CREATE UNIQUE INDEX "Inventory_skuId_key" ON "Inventory"("skuId");
CREATE INDEX "Inventory_productId_idx" ON "Inventory"("productId");
CREATE INDEX "Inventory_storeId_idx" ON "Inventory"("storeId");
CREATE TABLE "new_InventoryRecord" (
    "storeId" INTEGER NOT NULL DEFAULT 1,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "skuId" INTEGER,
    "type" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "beforeQuantity" REAL NOT NULL,
    "afterQuantity" REAL NOT NULL,
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
INSERT INTO "new_InventoryRecord" ("afterQuantity", "beforeQuantity", "createdAt", "id", "operatorId", "productId", "quantity", "reason", "relatedOrderId", "relatedPurchaseOrderId", "skuId", "type") SELECT "afterQuantity", "beforeQuantity", "createdAt", "id", "operatorId", "productId", "quantity", "reason", "relatedOrderId", "relatedPurchaseOrderId", "skuId", "type" FROM "InventoryRecord";
DROP TABLE "InventoryRecord";
ALTER TABLE "new_InventoryRecord" RENAME TO "InventoryRecord";
CREATE INDEX "InventoryRecord_productId_idx" ON "InventoryRecord"("productId");
CREATE INDEX "InventoryRecord_skuId_idx" ON "InventoryRecord"("skuId");
CREATE INDEX "InventoryRecord_type_idx" ON "InventoryRecord"("type");
CREATE INDEX "InventoryRecord_createdAt_idx" ON "InventoryRecord"("createdAt");
CREATE INDEX "InventoryRecord_storeId_idx" ON "InventoryRecord"("storeId");
CREATE TABLE "new_Order" (
    "storeId" INTEGER NOT NULL DEFAULT 1,
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
INSERT INTO "new_Order" ("actualAmount", "createdAt", "customerId", "discountAmount", "discountRate", "id", "notes", "operatorId", "orderNo", "paidAmount", "printedAt", "settlementAccount", "status", "totalAmount", "updatedAt") SELECT "actualAmount", "createdAt", "customerId", "discountAmount", "discountRate", "id", "notes", "operatorId", "orderNo", "paidAmount", "printedAt", "settlementAccount", "status", "totalAmount", "updatedAt" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_orderNo_key" ON "Order"("orderNo");
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");
CREATE INDEX "Order_status_idx" ON "Order"("status");
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");
CREATE INDEX "Order_storeId_idx" ON "Order"("storeId");
CREATE TABLE "new_OrderItem" (
    "storeId" INTEGER NOT NULL DEFAULT 1,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "skuId" INTEGER,
    "productName" TEXT NOT NULL,
    "specText" TEXT,
    "quantity" REAL NOT NULL,
    "returnedQty" REAL NOT NULL DEFAULT 0,
    "unitPrice" REAL NOT NULL,
    "costSnapshot" REAL,
    "subtotal" REAL NOT NULL,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_OrderItem" ("costSnapshot", "id", "orderId", "productId", "productName", "quantity", "returnedQty", "skuId", "specText", "subtotal", "unitPrice") SELECT "costSnapshot", "id", "orderId", "productId", "productName", "quantity", "returnedQty", "skuId", "specText", "subtotal", "unitPrice" FROM "OrderItem";
DROP TABLE "OrderItem";
ALTER TABLE "new_OrderItem" RENAME TO "OrderItem";
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");
CREATE INDEX "OrderItem_storeId_idx" ON "OrderItem"("storeId");
CREATE TABLE "new_PaymentRecord" (
    "storeId" INTEGER NOT NULL DEFAULT 1,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "direction" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "account" TEXT,
    "orderId" INTEGER,
    "purchaseOrderId" INTEGER,
    "customerId" INTEGER,
    "supplierId" INTEGER,
    "note" TEXT,
    "paidAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operatorId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_PaymentRecord" ("account", "amount", "createdAt", "customerId", "direction", "id", "note", "operatorId", "orderId", "paidAt", "purchaseOrderId", "supplierId") SELECT "account", "amount", "createdAt", "customerId", "direction", "id", "note", "operatorId", "orderId", "paidAt", "purchaseOrderId", "supplierId" FROM "PaymentRecord";
DROP TABLE "PaymentRecord";
ALTER TABLE "new_PaymentRecord" RENAME TO "PaymentRecord";
CREATE INDEX "PaymentRecord_paidAt_idx" ON "PaymentRecord"("paidAt");
CREATE INDEX "PaymentRecord_orderId_idx" ON "PaymentRecord"("orderId");
CREATE INDEX "PaymentRecord_customerId_idx" ON "PaymentRecord"("customerId");
CREATE INDEX "PaymentRecord_storeId_idx" ON "PaymentRecord"("storeId");
CREATE TABLE "new_PricingRule" (
    "storeId" INTEGER NOT NULL DEFAULT 1,
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
INSERT INTO "new_PricingRule" ("createdAt", "customerId", "id", "price", "productId", "skuId", "updatedAt") SELECT "createdAt", "customerId", "id", "price", "productId", "skuId", "updatedAt" FROM "PricingRule";
DROP TABLE "PricingRule";
ALTER TABLE "new_PricingRule" RENAME TO "PricingRule";
CREATE INDEX "PricingRule_customerId_idx" ON "PricingRule"("customerId");
CREATE INDEX "PricingRule_storeId_idx" ON "PricingRule"("storeId");
CREATE UNIQUE INDEX "PricingRule_skuId_customerId_key" ON "PricingRule"("skuId", "customerId");
CREATE TABLE "new_Product" (
    "storeId" INTEGER NOT NULL DEFAULT 1,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productTypeId" INTEGER NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '件',
    "defaultPrice" REAL NOT NULL DEFAULT 0,
    "costPrice" REAL,
    "barcode" TEXT,
    "imageUrl" TEXT,
    "customFields" TEXT NOT NULL DEFAULT '{}',
    "status" INTEGER NOT NULL DEFAULT 1,
    "isDeleted" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_productTypeId_fkey" FOREIGN KEY ("productTypeId") REFERENCES "ProductType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("barcode", "code", "costPrice", "createdAt", "customFields", "defaultPrice", "id", "imageUrl", "isDeleted", "name", "productTypeId", "status", "unit", "updatedAt") SELECT "barcode", "code", "costPrice", "createdAt", "customFields", "defaultPrice", "id", "imageUrl", "isDeleted", "name", "productTypeId", "status", "unit", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_code_key" ON "Product"("code");
CREATE INDEX "Product_productTypeId_idx" ON "Product"("productTypeId");
CREATE INDEX "Product_name_idx" ON "Product"("name");
CREATE INDEX "Product_storeId_idx" ON "Product"("storeId");
CREATE TABLE "new_ProductType" (
    "storeId" INTEGER NOT NULL DEFAULT 1,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "description" TEXT,
    "isPreset" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDeleted" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ProductType" ("createdAt", "description", "icon", "id", "isDeleted", "isPreset", "name", "sortOrder", "updatedAt") SELECT "createdAt", "description", "icon", "id", "isDeleted", "isPreset", "name", "sortOrder", "updatedAt" FROM "ProductType";
DROP TABLE "ProductType";
ALTER TABLE "new_ProductType" RENAME TO "ProductType";
CREATE INDEX "ProductType_storeId_idx" ON "ProductType"("storeId");
CREATE TABLE "new_PurchaseOrder" (
    "storeId" INTEGER NOT NULL DEFAULT 1,
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
INSERT INTO "new_PurchaseOrder" ("actualAmount", "createdAt", "discountAmount", "discountRate", "id", "notes", "operatorId", "orderNo", "paidAmount", "printedAt", "settlementAccount", "status", "supplierId", "totalAmount", "updatedAt") SELECT "actualAmount", "createdAt", "discountAmount", "discountRate", "id", "notes", "operatorId", "orderNo", "paidAmount", "printedAt", "settlementAccount", "status", "supplierId", "totalAmount", "updatedAt" FROM "PurchaseOrder";
DROP TABLE "PurchaseOrder";
ALTER TABLE "new_PurchaseOrder" RENAME TO "PurchaseOrder";
CREATE UNIQUE INDEX "PurchaseOrder_orderNo_key" ON "PurchaseOrder"("orderNo");
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");
CREATE INDEX "PurchaseOrder_createdAt_idx" ON "PurchaseOrder"("createdAt");
CREATE INDEX "PurchaseOrder_storeId_idx" ON "PurchaseOrder"("storeId");
CREATE TABLE "new_PurchaseOrderItem" (
    "storeId" INTEGER NOT NULL DEFAULT 1,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "purchaseOrderId" INTEGER NOT NULL,
    "skuId" INTEGER NOT NULL,
    "productName" TEXT NOT NULL,
    "specText" TEXT,
    "quantity" REAL NOT NULL,
    "returnedQty" REAL NOT NULL DEFAULT 0,
    "unitPrice" REAL NOT NULL,
    "subtotal" REAL NOT NULL,
    CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrderItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PurchaseOrderItem" ("id", "productName", "purchaseOrderId", "quantity", "returnedQty", "skuId", "specText", "subtotal", "unitPrice") SELECT "id", "productName", "purchaseOrderId", "quantity", "returnedQty", "skuId", "specText", "subtotal", "unitPrice" FROM "PurchaseOrderItem";
DROP TABLE "PurchaseOrderItem";
ALTER TABLE "new_PurchaseOrderItem" RENAME TO "PurchaseOrderItem";
CREATE INDEX "PurchaseOrderItem_purchaseOrderId_idx" ON "PurchaseOrderItem"("purchaseOrderId");
CREATE INDEX "PurchaseOrderItem_storeId_idx" ON "PurchaseOrderItem"("storeId");
CREATE TABLE "new_Recipe" (
    "storeId" INTEGER NOT NULL DEFAULT 1,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ownerSkuId" INTEGER NOT NULL,
    "componentSkuId" INTEGER NOT NULL,
    "qty" REAL NOT NULL
);
INSERT INTO "new_Recipe" ("componentSkuId", "id", "ownerSkuId", "qty") SELECT "componentSkuId", "id", "ownerSkuId", "qty" FROM "Recipe";
DROP TABLE "Recipe";
ALTER TABLE "new_Recipe" RENAME TO "Recipe";
CREATE INDEX "Recipe_ownerSkuId_idx" ON "Recipe"("ownerSkuId");
CREATE INDEX "Recipe_storeId_idx" ON "Recipe"("storeId");
CREATE UNIQUE INDEX "Recipe_ownerSkuId_componentSkuId_key" ON "Recipe"("ownerSkuId", "componentSkuId");
CREATE TABLE "new_Setting" (
    "storeId" INTEGER NOT NULL DEFAULT 1,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    PRIMARY KEY ("storeId", "key")
);
INSERT INTO "new_Setting" ("key", "value") SELECT "key", "value" FROM "Setting";
DROP TABLE "Setting";
ALTER TABLE "new_Setting" RENAME TO "Setting";
CREATE TABLE "new_Sku" (
    "storeId" INTEGER NOT NULL DEFAULT 1,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "specValues" TEXT NOT NULL DEFAULT '{}',
    "specText" TEXT NOT NULL DEFAULT '',
    "price" REAL NOT NULL DEFAULT 0,
    "costPrice" REAL,
    "barcode" TEXT,
    "imageUrl" TEXT,
    "isDefault" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Sku_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Sku" ("barcode", "code", "costPrice", "createdAt", "id", "imageUrl", "isDefault", "price", "productId", "specText", "specValues", "status", "updatedAt") SELECT "barcode", "code", "costPrice", "createdAt", "id", "imageUrl", "isDefault", "price", "productId", "specText", "specValues", "status", "updatedAt" FROM "Sku";
DROP TABLE "Sku";
ALTER TABLE "new_Sku" RENAME TO "Sku";
CREATE UNIQUE INDEX "Sku_code_key" ON "Sku"("code");
CREATE INDEX "Sku_productId_idx" ON "Sku"("productId");
CREATE INDEX "Sku_barcode_idx" ON "Sku"("barcode");
CREATE INDEX "Sku_storeId_idx" ON "Sku"("storeId");
CREATE TABLE "new_Stocktake" (
    "storeId" INTEGER NOT NULL DEFAULT 1,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderNo" TEXT NOT NULL,
    "productTypeId" INTEGER,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "diffItems" INTEGER NOT NULL DEFAULT 0,
    "gainQty" REAL NOT NULL DEFAULT 0,
    "lossQty" REAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "operatorId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Stocktake" ("createdAt", "diffItems", "gainQty", "id", "lossQty", "notes", "operatorId", "orderNo", "productTypeId", "totalItems") SELECT "createdAt", "diffItems", "gainQty", "id", "lossQty", "notes", "operatorId", "orderNo", "productTypeId", "totalItems" FROM "Stocktake";
DROP TABLE "Stocktake";
ALTER TABLE "new_Stocktake" RENAME TO "Stocktake";
CREATE UNIQUE INDEX "Stocktake_orderNo_key" ON "Stocktake"("orderNo");
CREATE INDEX "Stocktake_createdAt_idx" ON "Stocktake"("createdAt");
CREATE INDEX "Stocktake_storeId_idx" ON "Stocktake"("storeId");
CREATE TABLE "new_StocktakeItem" (
    "storeId" INTEGER NOT NULL DEFAULT 1,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "stocktakeId" INTEGER NOT NULL,
    "skuId" INTEGER NOT NULL,
    "productName" TEXT NOT NULL,
    "specText" TEXT,
    "systemQty" REAL NOT NULL,
    "actualQty" REAL NOT NULL,
    "diff" REAL NOT NULL,
    CONSTRAINT "StocktakeItem_stocktakeId_fkey" FOREIGN KEY ("stocktakeId") REFERENCES "Stocktake" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_StocktakeItem" ("actualQty", "diff", "id", "productName", "skuId", "specText", "stocktakeId", "systemQty") SELECT "actualQty", "diff", "id", "productName", "skuId", "specText", "stocktakeId", "systemQty" FROM "StocktakeItem";
DROP TABLE "StocktakeItem";
ALTER TABLE "new_StocktakeItem" RENAME TO "StocktakeItem";
CREATE INDEX "StocktakeItem_stocktakeId_idx" ON "StocktakeItem"("stocktakeId");
CREATE INDEX "StocktakeItem_storeId_idx" ON "StocktakeItem"("storeId");
CREATE TABLE "new_Supplier" (
    "storeId" INTEGER NOT NULL DEFAULT 1,
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
INSERT INTO "new_Supplier" ("address", "contactPerson", "createdAt", "id", "isDeleted", "name", "notes", "phone", "updatedAt") SELECT "address", "contactPerson", "createdAt", "id", "isDeleted", "name", "notes", "phone", "updatedAt" FROM "Supplier";
DROP TABLE "Supplier";
ALTER TABLE "new_Supplier" RENAME TO "Supplier";
CREATE INDEX "Supplier_name_idx" ON "Supplier"("name");
CREATE INDEX "Supplier_storeId_idx" ON "Supplier"("storeId");
CREATE TABLE "new_User" (
    "storeId" INTEGER NOT NULL DEFAULT 1,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "realName" TEXT NOT NULL,
    "phone" TEXT,
    "role" TEXT NOT NULL DEFAULT 'staff',
    "status" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("createdAt", "id", "passwordHash", "phone", "realName", "role", "status", "updatedAt", "username") SELECT "createdAt", "id", "passwordHash", "phone", "realName", "role", "status", "updatedAt", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE INDEX "User_storeId_idx" ON "User"("storeId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


-- 默认店铺：迁移前的全部数据归属店 1
INSERT INTO "Store" ("id", "name") VALUES (1, '默认店铺');
