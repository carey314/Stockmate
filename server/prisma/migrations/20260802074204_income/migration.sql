-- CreateTable
CREATE TABLE "Income" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "note" TEXT,
    "incomeDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operatorId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Income_incomeDate_idx" ON "Income"("incomeDate");
