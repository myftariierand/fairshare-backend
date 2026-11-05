import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

// Google accounts used to be stored with a hash of an empty string, which let anyone
// log in to them. Run once after the make_user_password_optional migration. Checking
// each hash keeps the real passwords of Google users who have since set one.
async function main() {
  const prisma = new PrismaClient();

  const users = await prisma.user.findMany({
    where: { password: { not: null } },
    select: { id: true, password: true },
  });

  let cleared = 0;

  for (const { id, password } of users) {
    if (password !== null && (await bcrypt.compare('', password))) {
      await prisma.user.update({ where: { id }, data: { password: null } });
      cleared++;
    }
  }

  console.log(`Cleared ${cleared} of ${users.length} password hashes`);

  await prisma.$disconnect();
}

main();
