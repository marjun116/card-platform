-- AlterTable
ALTER TABLE "Table" ADD COLUMN     "rematchId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Table_rematchId_key" ON "Table"("rematchId");

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_rematchId_fkey" FOREIGN KEY ("rematchId") REFERENCES "Table"("id") ON DELETE SET NULL ON UPDATE CASCADE;

