-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "inviteToken" TEXT;

-- Give every existing group its own token
UPDATE "Group" SET "inviteToken" = gen_random_uuid()::text;

-- AlterTable
ALTER TABLE "Group" ALTER COLUMN "inviteToken" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Group_inviteToken_key" ON "Group"("inviteToken");
