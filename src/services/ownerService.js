// Each platform has exactly one owner, or none: the user whose numeric ID is in
// GITHUB_ADMIN_ID or GITLAB_ADMIN_ID. The `owner` role in the database only mirrors that
// setting. Any other account still marked owner (an older list, a hand edit, a changed
// setting) counts as a member and is set back to member when it is next seen.
const config = require('../config');
const prisma = require('../db');
const { OWNER, MEMBER } = require('./roles');

function ownerIdFor(platform) {
  return (config[platform] && config[platform].ownerId) || '';
}

function isOwnerId(platform, id) {
  const ownerId = ownerIdFor(platform);
  return Boolean(ownerId) && ownerId === String(id);
}

// The role an account really has: owner only for the configured ID.
function effectiveRole(platform, account) {
  if (account.role !== OWNER) return account.role;
  return isOwnerId(platform, account.id) ? OWNER : MEMBER;
}

// The caller's whitelisted account, or null, with the database brought in line:
// - the configured owner is whitelisted and made owner on first sign-in, and every other
//   account of that platform loses the owner role in the same transaction;
// - anyone else marked owner is set back to member.
async function syncAccount(platform, id) {
  const where = { type_id: { type: platform, id: String(id) } };
  const account = await prisma.account.findUnique({ where });

  if (isOwnerId(platform, id)) {
    const others = await prisma.account.count({ where: { type: platform, role: OWNER, NOT: { id: String(id) } } });
    if (account && account.role === OWNER && others === 0) return account;
    const [, owner] = await prisma.$transaction([
      prisma.account.updateMany({ where: { type: platform, role: OWNER, NOT: { id: String(id) } }, data: { role: MEMBER } }),
      prisma.account.upsert({ where, create: { type: platform, id: String(id), role: OWNER }, update: { role: OWNER } }),
    ]);
    return owner;
  }

  if (account && account.role === OWNER) {
    return prisma.account.update({ where, data: { role: MEMBER } });
  }
  return account;
}

module.exports = { ownerIdFor, isOwnerId, effectiveRole, syncAccount };
