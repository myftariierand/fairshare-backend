/*
  Warnings:

  - You are about to drop the column `createAt` on the `Friendships` table. All the data in the column will be lost.
  - You are about to drop the column `updateAt` on the `Friendships` table. All the data in the column will be lost.
  - You are about to drop the `_UserFriends` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `updatedAt` to the `Friendships` table without a default value. This is not possible if the table is not empty.
  - Added the required column `paidById` to the `Transaction` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('EXPENSE', 'SETTLEMENT');

-- DropForeignKey
ALTER TABLE "TransactionSplit" DROP CONSTRAINT "TransactionSplit_transactionId_fkey";

-- DropForeignKey
ALTER TABLE "_UserFriends" DROP CONSTRAINT "_UserFriends_A_fkey";

-- DropForeignKey
ALTER TABLE "_UserFriends" DROP CONSTRAINT "_UserFriends_B_fkey";

-- AlterTable
ALTER TABLE "Friendships" DROP COLUMN "createAt",
DROP COLUMN "updateAt",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "paidById" TEXT NOT NULL,
ADD COLUMN     "type" "TransactionType" NOT NULL DEFAULT 'EXPENSE';

-- DropTable
DROP TABLE "_UserFriends";

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSplit" ADD CONSTRAINT "TransactionSplit_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
