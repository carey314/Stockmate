-- CreateTable
CREATE TABLE "PaymentRecord" (
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

-- CreateIndex
CREATE INDEX "PaymentRecord_paidAt_idx" ON "PaymentRecord"("paidAt");

-- CreateIndex
CREATE INDEX "PaymentRecord_orderId_idx" ON "PaymentRecord"("orderId");

-- CreateIndex
CREATE INDEX "PaymentRecord_customerId_idx" ON "PaymentRecord"("customerId");
