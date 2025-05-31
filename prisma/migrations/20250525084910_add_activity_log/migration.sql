-- CreateEnum
CREATE TYPE "ActivityAction" AS ENUM ('USER_UPDATED_PROFILE', 'USER_CHANGED_PASSWORD', 'FRIENDSHIP_REQUEST_SENT', 'FRIENDSHIP_REQUEST_ACCEPTED', 'FRIENDSHIP_REQUEST_REJECTED', 'GROUP_CREATED', 'GROUP_UPDATED', 'GROUP_MEMBER_JOINED', 'GROUP_MEMBER_LEFT', 'GROUP_INVITATION_SENT', 'GROUP_INVITATION_ACCEPTED', 'GROUP_INVITATION_REJECTED', 'TRANSACTION_CREATED', 'TRANSACTION_UPDATED');

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" "ActivityAction" NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT,
    "transactionId" TEXT,
    "friendshipId" TEXT,
    "invitationId" TEXT,
    "details" TEXT NOT NULL,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityLog_userId_idx" ON "ActivityLog"("userId");

-- CreateIndex
CREATE INDEX "ActivityLog_groupId_idx" ON "ActivityLog"("groupId");

-- CreateIndex
CREATE INDEX "ActivityLog_transactionId_idx" ON "ActivityLog"("transactionId");

-- CreateIndex
CREATE INDEX "ActivityLog_friendshipId_idx" ON "ActivityLog"("friendshipId");

-- CreateIndex
CREATE INDEX "ActivityLog_invitationId_idx" ON "ActivityLog"("invitationId");

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_friendshipId_fkey" FOREIGN KEY ("friendshipId") REFERENCES "Friendships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "GroupInvitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
