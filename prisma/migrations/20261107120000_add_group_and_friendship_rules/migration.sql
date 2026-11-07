-- Lets a repeated create return the first result instead of adding a second expense
ALTER TABLE "Transaction" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Transaction_createdById_idempotencyKey_key" ON "Transaction"("createdById", "idempotencyKey");

-- Owners could leave their group, and then nobody could manage or delete it
UPDATE "Group" g
SET "createdById" = (
  SELECT m."userId" FROM "GroupMember" m
  WHERE m."groupId" = g."id"
  ORDER BY m."joinedAt", m."id"
  LIMIT 1
)
WHERE EXISTS (SELECT 1 FROM "GroupMember" m WHERE m."groupId" = g."id")
  AND NOT EXISTS (
    SELECT 1 FROM "GroupMember" m
    WHERE m."groupId" = g."id" AND m."userId" = g."createdById"
  );

-- Existing rows have to go first or the rules below can't be added. For a pair with both
-- directions, an accepted friendship wins, then a pending request, then the oldest.
DELETE FROM "Friendships" WHERE "senderId" = "receiverId";

DELETE FROM "Friendships" f
USING (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY LEAST("senderId", "receiverId"), GREATEST("senderId", "receiverId")
    ORDER BY
      CASE "status" WHEN 'ACCEPTED' THEN 0 WHEN 'PENDING' THEN 1 ELSE 2 END,
      "createdAt",
      "id"
  ) AS "rank"
  FROM "Friendships"
) ranked
WHERE f."id" = ranked."id" AND ranked."rank" > 1;

-- Prisma's schema can't express these two, so they live only here. It leaves them alone.
CREATE UNIQUE INDEX "Friendships_pair_key" ON "Friendships"(LEAST("senderId", "receiverId"), GREATEST("senderId", "receiverId"));

ALTER TABLE "Friendships" ADD CONSTRAINT "Friendships_not_self" CHECK ("senderId" <> "receiverId");
