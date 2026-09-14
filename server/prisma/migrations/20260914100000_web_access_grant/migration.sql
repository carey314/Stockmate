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
