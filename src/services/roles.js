// Account roles, stored in lower case. "owner" is the platform's one owner (GITHUB_ADMIN_ID /
// GITLAB_ADMIN_ID); everyone else who signs in is "free". More roles can be added here later.
const OWNER = 'owner';
const FREE = 'free';
const ROLES = [OWNER, FREE];

module.exports = { OWNER, FREE, ROLES };
