-- CreateEnum
CREATE TYPE "TransactionCategory" AS ENUM ('FOOD', 'GROCERIES', 'ACCOMMODATION', 'TRANSPORTATION', 'UTILITIES', 'ENTERTAINMENT', 'SHOPPING', 'TRAVEL', 'GIFTS', 'HEALTH', 'FEES', 'OTHER');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "category" "TransactionCategory" DEFAULT 'OTHER';
