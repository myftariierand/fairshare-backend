/*
  Warnings:

  - You are about to drop the column `details` on the `ActivityLog` table. All the data in the column will be lost.
  - You are about to drop the column `friendshipId` on the `ActivityLog` table. All the data in the column will be lost.
  - You are about to drop the column `invitationId` on the `ActivityLog` table. All the data in the column will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityAction" ADD VALUE 'USER_REGISTERED';
ALTER TYPE "ActivityAction" ADD VALUE 'FRIENDSHIP_REQUEST_CANCELLED';
ALTER TYPE "ActivityAction" ADD VALUE 'FRIENDSHIP_REMOVED';
ALTER TYPE "ActivityAction" ADD VALUE 'GROUP_DELETED';
ALTER TYPE "ActivityAction" ADD VALUE 'GROUP_MEMBER_REMOVED';
ALTER TYPE "ActivityAction" ADD VALUE 'TRANSACTION_DELETED';
ALTER TYPE "ActivityAction" ADD VALUE 'TRANSACTION_SETTLED';

-- DropForeignKey
ALTER TABLE "ActivityLog" DROP CONSTRAINT "ActivityLog_friendshipId_fkey";

-- DropForeignKey
ALTER TABLE "ActivityLog" DROP CONSTRAINT "ActivityLog_groupId_fkey";

-- DropForeignKey
ALTER TABLE "ActivityLog" DROP CONSTRAINT "ActivityLog_invitationId_fkey";

-- DropForeignKey
ALTER TABLE "ActivityLog" DROP CONSTRAINT "ActivityLog_transactionId_fkey";

-- DropIndex
DROP INDEX "ActivityLog_friendshipId_idx";

-- DropIndex
DROP INDEX "ActivityLog_invitationId_idx";

-- AlterTable
ALTER TABLE "ActivityLog" DROP COLUMN "details",
DROP COLUMN "friendshipId",
DROP COLUMN "invitationId",
ADD COLUMN     "snapshot" JSONB,
ADD COLUMN     "targetUserId" TEXT;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
