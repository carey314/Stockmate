-- AlterTable
ALTER TABLE "Entitlement" ADD COLUMN "appleEnvironment" TEXT;
ALTER TABLE "Entitlement" ADD COLUMN "appleProductId" TEXT;
ALTER TABLE "Entitlement" ADD COLUMN "applePurchaseAt" DATETIME;
ALTER TABLE "Entitlement" ADD COLUMN "appleRevokedAt" DATETIME;
ALTER TABLE "Entitlement" ADD COLUMN "appleTransactionId" TEXT;
ALTER TABLE "Entitlement" ADD COLUMN "appleVerifiedAt" DATETIME;

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

