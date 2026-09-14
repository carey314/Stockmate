-- AlterTable
ALTER TABLE "Entitlement" ADD COLUMN "appleEnvironment" TEXT;
ALTER TABLE "Entitlement" ADD COLUMN "appleProductId" TEXT;
ALTER TABLE "Entitlement" ADD COLUMN "applePurchaseAt" DATETIME;
ALTER TABLE "Entitlement" ADD COLUMN "appleRevokedAt" DATETIME;
ALTER TABLE "Entitlement" ADD COLUMN "appleTransactionId" TEXT;
ALTER TABLE "Entitlement" ADD COLUMN "appleVerifiedAt" DATETIME;

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

-- CreateTable
CREATE TABLE "WebLoginChallenge" (
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "storeId" INTEGER NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WebLoginCode" (
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "storeId" INTEGER NOT NULL,
    "appleSub" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AppleNotification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "originalTransactionId" TEXT,
    "state" TEXT,
    "signedAt" DATETIME NOT NULL,
    "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PhoneIdentity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "phone" TEXT NOT NULL,
    "verifiedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PhoneIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SmsChallenge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "userId" INTEGER,
    "storeId" INTEGER,
    "sessionVersion" INTEGER,
    "identityId" TEXT,
    "state" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "registrationHash" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SmsReauth" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "storeId" INTEGER NOT NULL,
    "sessionVersion" INTEGER NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "verifiedAt" DATETIME,
    "usedAt" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SmsRateBucket" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL DEFAULT 0,
    "nextAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL
);

ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "TradeEvent_storeId_documentType_occurredAt_idx" ON "TradeEvent"("storeId", "documentType", "occurredAt");

-- CreateIndex
CREATE INDEX "TradeEvent_storeId_documentType_documentId_idx" ON "TradeEvent"("storeId", "documentType", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "EntryConfirmation_storeId_requestKey_key" ON "EntryConfirmation"("storeId", "requestKey");

-- CreateIndex
CREATE INDEX "WebLoginChallenge_userId_expiresAt_idx" ON "WebLoginChallenge"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebLoginCode_codeHash_key" ON "WebLoginCode"("codeHash");

-- CreateIndex
CREATE INDEX "WebLoginCode_userId_expiresAt_idx" ON "WebLoginCode"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "AppleNotification_originalTransactionId_signedAt_idx" ON "AppleNotification"("originalTransactionId", "signedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PhoneIdentity_userId_key" ON "PhoneIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PhoneIdentity_phone_key" ON "PhoneIdentity"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "SmsChallenge_registrationHash_key" ON "SmsChallenge"("registrationHash");

-- CreateIndex
CREATE INDEX "SmsChallenge_phone_purpose_idx" ON "SmsChallenge"("phone", "purpose");

-- CreateIndex
CREATE INDEX "SmsChallenge_userId_idx" ON "SmsChallenge"("userId");

-- CreateIndex
CREATE INDEX "SmsChallenge_expiresAt_idx" ON "SmsChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "SmsReauth_userId_idx" ON "SmsReauth"("userId");

-- CreateIndex
CREATE INDEX "SmsReauth_expiresAt_idx" ON "SmsReauth"("expiresAt");

-- CreateIndex
CREATE INDEX "SmsRateBucket_expiresAt_idx" ON "SmsRateBucket"("expiresAt");


-- Approved explicit Apple registration increment. Alternative complete production path.
-- Additive only: no legacy data rewrite or identity inference.
CREATE TABLE "AppleAuthAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nonceHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "tokenHash" TEXT,
    "appleSub" TEXT,
    "registrationHash" TEXT,
    "registrationExpiresAt" DATETIME,
    "userId" INTEGER,
    "storeId" INTEGER,
    "sessionVersion" INTEGER,
    "storeName" TEXT,
    "createdStore" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AppleAuthAttempt_registrationHash_key" ON "AppleAuthAttempt"("registrationHash");
CREATE INDEX "AppleAuthAttempt_expiresAt_idx" ON "AppleAuthAttempt"("expiresAt");
CREATE INDEX "AppleAuthAttempt_registrationExpiresAt_idx" ON "AppleAuthAttempt"("registrationExpiresAt");
CREATE INDEX "AppleAuthAttempt_userId_idx" ON "AppleAuthAttempt"("userId");
CREATE INDEX "AppleAuthAttempt_appleSub_idx" ON "AppleAuthAttempt"("appleSub");

-- 2026-09-14 Web login authorization (additive)
CREATE TABLE "WebAccessGrant" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "kind" TEXT NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'pending',
 "scanHash" TEXT,
 "browserHash" TEXT,
 "codeHash" TEXT,
 "userId" INTEGER,
 "storeId" INTEGER,
 "sessionVersion" INTEGER,
 "browserLabel" TEXT NOT NULL,
 "expiresAt" DATETIME NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "WebAccessGrant_codeHash_key" ON "WebAccessGrant"("codeHash");
CREATE INDEX "WebAccessGrant_expiresAt_idx" ON "WebAccessGrant"("expiresAt");
CREATE INDEX "WebAccessGrant_userId_idx" ON "WebAccessGrant"("userId");

-- 2026-09-14 platform operations and experience grants
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

