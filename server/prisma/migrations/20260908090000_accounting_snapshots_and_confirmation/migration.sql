-- AlterTable
ALTER TABLE "Order" ADD COLUMN "originalAmount" REAL;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "costAmountCents" INTEGER;
ALTER TABLE "OrderItem" ADD COLUMN "netAmountCents" INTEGER;
ALTER TABLE "OrderItem" ADD COLUMN "stockSnapshot" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN "originalAmount" REAL;

-- AlterTable
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "netAmountCents" INTEGER;

-- CreateTable
CREATE TABLE "TradeEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "storeId" INTEGER NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "productId" INTEGER NOT NULL,
    "skuId" INTEGER,
    "productName" TEXT NOT NULL,
    "specText" TEXT,
    "partnerId" INTEGER,
    "operatorId" INTEGER NOT NULL,
    "actorId" INTEGER NOT NULL,
    "quantity" REAL NOT NULL,
    "netAmount" REAL NOT NULL,
    "costAmount" REAL
);

-- CreateTable
CREATE TABLE "EntryConfirmation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "storeId" INTEGER NOT NULL,
    "requestKey" TEXT NOT NULL,
    "actorId" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "TradeEvent_storeId_documentType_occurredAt_idx" ON "TradeEvent"("storeId", "documentType", "occurredAt");

-- CreateIndex
CREATE INDEX "TradeEvent_storeId_documentType_documentId_idx" ON "TradeEvent"("storeId", "documentType", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "EntryConfirmation_storeId_requestKey_key" ON "EntryConfirmation"("storeId", "requestKey");

