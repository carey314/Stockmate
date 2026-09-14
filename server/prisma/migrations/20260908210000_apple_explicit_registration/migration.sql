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
