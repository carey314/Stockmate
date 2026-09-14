-- CreateTable
CREATE TABLE "PlatformAdmin" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PlatformAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adminId" INTEGER,
    "actorUserId" INTEGER,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "storeId" INTEGER,
    "reason" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PromoBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adminId" INTEGER NOT NULL,
    "requestId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "redeemExpiresAt" DATETIME,
    "sealedCodes" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PromoCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeHint" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'unused',
    "redeemExpiresAt" DATETIME,
    "storeId" INTEGER,
    "userId" INTEGER,
    "entitlementId" INTEGER,
    "redeemedAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AiRequestRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "storeId" INTEGER NOT NULL,
    "endpoint" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "cacheHitTokens" INTEGER,
    "cacheMissTokens" INTEGER,
    "totalTokens" INTEGER,
    "estimatedCost" REAL,
    "currency" TEXT,
    "pricingSnapshot" TEXT,
    "errorCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PlatformEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventKey" TEXT NOT NULL,
    "userId" INTEGER,
    "storeId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "metadata" TEXT,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAdmin_username_key" ON "PlatformAdmin"("username");

-- CreateIndex
CREATE INDEX "PlatformAudit_createdAt_idx" ON "PlatformAudit"("createdAt");

-- CreateIndex
CREATE INDEX "PlatformAudit_adminId_createdAt_idx" ON "PlatformAudit"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformAudit_storeId_createdAt_idx" ON "PlatformAudit"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "PromoBatch_createdAt_idx" ON "PromoBatch"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PromoBatch_adminId_requestId_key" ON "PromoBatch"("adminId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "PromoCode_codeHash_key" ON "PromoCode"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "PromoCode_entitlementId_key" ON "PromoCode"("entitlementId");

-- CreateIndex
CREATE INDEX "PromoCode_batchId_idx" ON "PromoCode"("batchId");

-- CreateIndex
CREATE INDEX "PromoCode_storeId_idx" ON "PromoCode"("storeId");

-- CreateIndex
CREATE INDEX "PromoCode_state_createdAt_idx" ON "PromoCode"("state", "createdAt");

-- CreateIndex
CREATE INDEX "AiRequestRecord_storeId_createdAt_idx" ON "AiRequestRecord"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "AiRequestRecord_userId_createdAt_idx" ON "AiRequestRecord"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiRequestRecord_createdAt_idx" ON "AiRequestRecord"("createdAt");

-- CreateIndex
CREATE INDEX "AiRequestRecord_requestId_idx" ON "AiRequestRecord"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformEvent_eventKey_key" ON "PlatformEvent"("eventKey");

-- CreateIndex
CREATE INDEX "PlatformEvent_storeId_occurredAt_idx" ON "PlatformEvent"("storeId", "occurredAt");

-- CreateIndex
CREATE INDEX "PlatformEvent_userId_occurredAt_idx" ON "PlatformEvent"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "PlatformEvent_kind_occurredAt_idx" ON "PlatformEvent"("kind", "occurredAt");

