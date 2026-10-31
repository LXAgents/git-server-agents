// Account roles, stored in lower case. Only "owner" carries rights today; more roles can be
// added here later.
const OWNER = 'owner';
const MEMBER = 'member';
const ROLES = [OWNER, MEMBER];

module.exports = { OWNER, MEMBER, ROLES };
