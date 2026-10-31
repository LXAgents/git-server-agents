// 1.7.0 stopped storing usernames: profiles are read from GitHub/GitLab instead. Prisma's
// `db push` refuses to drop a column that still holds data, so this empties the old
// Account.username column first. It does nothing on a database that never had the column or
// already lost it, or before the Prisma client is generated. Safe to run on every start.
async function main() {
  let prisma;
  try {
    prisma = require('../src/db');
    const count = await prisma.$executeRawUnsafe('UPDATE "Account" SET "username" = NULL WHERE "username" IS NOT NULL');
    if (count > 0) console.log(`[clear-usernames] cleared ${count} stored username(s)`);
  } catch {
    // No username column, no Account table yet, or no generated client: nothing to clear.
  } finally {
    if (prisma) await prisma.$disconnect();
  }
}

// main() handles its own errors; this only reports one it could not.
main().catch((err) => {
  console.error('[clear-usernames]', err);
});
