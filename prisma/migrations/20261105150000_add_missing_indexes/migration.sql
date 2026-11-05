-- CreateIndex
CREATE INDEX "Group_createdById_idx" ON "Group"("createdById");

-- CreateIndex
CREATE INDEX "GroupMember_userId_idx" ON "GroupMember"("userId");

-- CreateIndex
CREATE INDEX "GroupInvitation_receiverId_idx" ON "GroupInvitation"("receiverId");

-- CreateIndex
CREATE INDEX "GroupInvitation_senderId_idx" ON "GroupInvitation"("senderId");

-- CreateIndex
CREATE INDEX "Transaction_groupId_createdAt_idx" ON "Transaction"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_paidById_idx" ON "Transaction"("paidById");

-- CreateIndex
CREATE INDEX "Transaction_createdById_idx" ON "Transaction"("createdById");

-- CreateIndex
CREATE INDEX "TransactionSplit_transactionId_idx" ON "TransactionSplit"("transactionId");

-- CreateIndex
CREATE INDEX "Friendships_receiverId_idx" ON "Friendships"("receiverId");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX "Task_createdById_idx" ON "Task"("createdById");

