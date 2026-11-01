// API views shared by the owner and user endpoints. Logins, names and avatars are read from
// the platform for each request, never stored.
const profiles = require('./profileService');
const { settingsMap } = require('./modelService');

function orgView(o, ownerProfile) {
  return {
    id: o.id,
    platform: o.platform,
    orgName: o.orgName,
    installationId: o.installationId,
    owner: { platform: o.accountType, id: o.accountId, ...profiles.describe(o.accountId, ownerProfile) },
    keyCount: o._count ? o._count.keys : undefined,
    models: o.models ? settingsMap(o.models) : undefined,
    createdAt: o.createdAt,
  };
}

// Org views with each importer's profile read from the platform.
async function orgViews(rows, platform, token) {
  const found = await profiles.getProfiles(platform, rows.map((o) => o.accountId), token);
  return rows.map((o) => orgView(o, found.get(String(o.accountId))));
}

// Names the user owners of key views by their platform login.
async function nameUserOwners(keys, platform, token) {
  const userIds = keys.filter((k) => k.owner.type === 'user').map((k) => k.owner.id);
  const found = await profiles.getProfiles(platform, userIds, token);
  for (const key of keys) {
    if (key.owner.type === 'user') key.owner.name = profiles.describe(key.owner.id, found.get(String(key.owner.id))).login;
  }
  return keys;
}

module.exports = { orgView, orgViews, nameUserOwners };
