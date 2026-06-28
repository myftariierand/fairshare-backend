/*
  Warnings:

  - You are about to drop the column `isSettledUp` on the `Group` table. All the data in the column will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionCategory" ADD VALUE 'DRINKS';
ALTER TYPE "TransactionCategory" ADD VALUE 'COFFEE';
ALTER TYPE "TransactionCategory" ADD VALUE 'SUBSCRIPTIONS';
ALTER TYPE "TransactionCategory" ADD VALUE 'EDUCATION';
ALTER TYPE "TransactionCategory" ADD VALUE 'SPORTS';
ALTER TYPE "TransactionCategory" ADD VALUE 'PETS';
ALTER TYPE "TransactionCategory" ADD VALUE 'TAXES';
ALTER TYPE "TransactionCategory" ADD VALUE 'MAINTENANCE';
ALTER TYPE "TransactionCategory" ADD VALUE 'INSURANCE';
ALTER TYPE "TransactionCategory" ADD VALUE 'CHILDCARE';
ALTER TYPE "TransactionCategory" ADD VALUE 'WORK';
ALTER TYPE "TransactionCategory" ADD VALUE 'DONATIONS';
ALTER TYPE "TransactionCategory" ADD VALUE 'PERSONAL_CARE';

-- AlterTable
ALTER TABLE "Group" DROP COLUMN "isSettledUp";
