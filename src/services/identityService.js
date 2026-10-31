// Pulls the acting user and the owning org out of a webhook payload.
// Every field is returned as a string, or null when the payload does not carry it.

function str(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

function githubIdentity(body = {}) {
  return {
    triggerUser: str(body.sender && body.sender.login),
    triggerUserId: str(body.sender && body.sender.id),
    targetOrg: str(
      (body.organization && body.organization.login) ||
        (body.installation && body.installation.account && body.installation.account.login) ||
        (body.repository && body.repository.owner && body.repository.owner.login)
    ),
    installationId: str(body.installation && body.installation.id),
  };
}

function gitlabIdentity(body = {}) {
  const project = body.project || {};
  const fullPath = project.path_with_namespace || '';
  return {
    triggerUser: str((body.user && body.user.username) || body.user_username),
    triggerUserId: str((body.user && body.user.id) || body.user_id),
    // The top-level group owns the whitelist entry, so subgroups inherit it.
    targetOrg: str(fullPath.split('/')[0]),
    installationId: null,
  };
}

module.exports = { githubIdentity, gitlabIdentity };
