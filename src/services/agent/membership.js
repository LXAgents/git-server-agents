// Who may spend org and repository keys. Any failure to confirm counts as "no" (fail closed).
const { platformOf } = require('./platform');
const { logSafe } = require('../../utils/strings');
const log = require('../logService');

// Org keys are spent only for members of the org.
async function isOrgMember(platform, identity, payload, token) {
  try {
    return Boolean(await platformOf(platform).isOrgMember(identity, payload, token));
  } catch (err) {
    log.warn('agent', `could not confirm ${logSafe(identity.triggerUser)} in ${logSafe(identity.targetOrg)}: ${logSafe(err.message)}`, { platform });
    return false;
  }
}

// Repo keys are spent only for people in the repo: a collaborator (GitHub), a project member
// (GitLab), or a member of its org.
async function isRepoMember(platform, identity, comment, orgMember, token) {
  if (orgMember) return true;
  try {
    return Boolean(await platformOf(platform).isRepoMember(identity, comment, token));
  } catch (err) {
    log.warn('agent', `could not confirm ${logSafe(identity.triggerUser)} in the repository: ${logSafe(err.message)}`, { platform });
    return false;
  }
}

module.exports = { isOrgMember, isRepoMember };
