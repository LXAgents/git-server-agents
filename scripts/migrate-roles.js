// 1.11.0 renamed the role of everyone who is not the owner from "member" to "free". This
// renames the stored rows. It does nothing when there are none, or before the Prisma client is
// generated. Safe to run on every start, after `prisma db push`.
async function main() {
  let prisma;
  try {
    prisma = require('../src/db');
    const { count } = await prisma.account.updateMany({ where: { role: 'member' }, data: { role: 'free' } });
    if (count > 0) console.log(`[migrate-roles] ${count} member account(s) are now free`);
  } catch {
    // No Account table yet, or no generated client: nothing to rename.
  } finally {
    if (prisma) await prisma.$disconnect();
  }
}

// main() handles its own errors; this only reports one it could not.
main().catch((err) => {
  console.error('[migrate-roles]', err);
});
