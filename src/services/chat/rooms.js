// Chat rooms and who may join them. Every subscribe and every post asks the platform again with
// the caller's own token; the answer is never stored.
//   user:{accountId}  the caller's own room (their account id on the session's platform)
//   repo:{repoId}     an imported repository: its admins and collaborators
//   org:{orgId}       an imported org: its owners and members
// Internally a user room's key also names the platform ("user:github:1001"), because the same
// numeric id can exist on GitHub and GitLab.
const prisma = require('../../db');
const platforms = require('../platforms/platformService');
const { HttpError } = require('../../errors');

const ROOM = /^(user|repo|org):([A-Za-z0-9_-]{1,64})$/;

function userRoomKey(platform, accountId) {
  return `user:${platform}:${accountId}`;
}
const repoRoomKey = (repositoryId) => `repo:${repositoryId}`;
const orgRoomKey = (appInstallationId) => `org:${appInstallationId}`;

function parseRoom(value) {
  const match = ROOM.exec(String(value || '').trim());
  if (!match) throw new HttpError(400, 'room must be user:{accountId}, repo:{repoId} or org:{orgId}');
  return { kind: match[1], id: match[2], room: `${match[1]}:${match[2]}` };
}

// The room `value` if `user` may be in it now: { kind, id, room, key, account | repository +
// installation + level | installation }. 404 for an unknown room, 403 for one that is not theirs.
async function authorizeRoom(user, value) {
  const parsed = parseRoom(value);
  if (parsed.kind === 'user') {
    if (parsed.id !== String(user.id)) throw new HttpError(403, 'you can only join your own user room');
    return { ...parsed, key: userRoomKey(user.platform, user.id), account: { type: user.platform, id: String(user.id) } };
  }
  if (parsed.kind === 'repo') {
    const repository = await prisma.repository.findUnique({ where: { id: parsed.id }, include: { appInstallation: true } });
    if (!repository || repository.platform !== user.platform) throw new HttpError(404, 'repository not found');
    const { level, defaultBranch } = await platforms.repoAccess(user.platform, user.token, user, repository);
    if (level === 'none') throw new HttpError(403, `you are not a collaborator of ${repository.fullName}`);
    return { ...parsed, key: repoRoomKey(repository.id), repository, installation: repository.appInstallation, level, defaultBranch, name: repository.fullName };
  }
  const installation = await prisma.appInstallation.findUnique({ where: { id: parsed.id } });
  if (!installation || installation.platform !== user.platform) throw new HttpError(404, 'org not found');
  if (!(await platforms.isOrgMember(user.platform, user.token, user, installation.orgName))) throw new HttpError(403, `you are not a member of ${installation.orgName}`);
  return { ...parsed, key: orgRoomKey(installation.id), installation, name: installation.orgName };
}

const MAX_LISTED = 100;

// The rooms the user may join now, for the dashboard's pickers: their own room, then imported
// orgs they are in and imported repositories they can read, on their platform.
async function listRooms(user) {
  const [orgs, repos] = await Promise.all([
    prisma.appInstallation.findMany({ where: { platform: user.platform }, orderBy: { orgName: 'asc' }, take: MAX_LISTED }),
    prisma.repository.findMany({ where: { platform: user.platform }, orderBy: { fullName: 'asc' }, take: MAX_LISTED }),
  ]);
  const [orgOk, repoOk] = await Promise.all([
    Promise.all(orgs.map((o) => platforms.isOrgMember(user.platform, user.token, user, o.orgName).catch(() => false))),
    Promise.all(repos.map((r) => platforms.repoAccess(user.platform, user.token, user, r).then((a) => a.level !== 'none', () => false))),
  ]);
  return {
    user: { room: `user:${user.id}`, name: user.login },
    orgs: orgs.filter((_o, i) => orgOk[i]).map((o) => ({ room: `org:${o.id}`, name: o.orgName })),
    repos: repos.filter((_r, i) => repoOk[i]).map((r) => ({ room: `repo:${r.id}`, name: r.fullName })),
  };
}

module.exports = { parseRoom, authorizeRoom, listRooms, userRoomKey, repoRoomKey, orgRoomKey };
