// Who a user is (login, display name, avatar) comes from GitHub or GitLab, never from our
// database. Answers are kept in memory for a short while so a page of users doesn't call the
// platform once per row on every load.
const platforms = require('./platforms/platformService');

const TTL_MS = 10 * 60 * 1000;
const cache = new Map();

const keyOf = (platform, id) => `${platform}:${id}`;

function remember(platform, id, profile) {
  cache.set(keyOf(platform, id), { profile, expires: Date.now() + TTL_MS });
}

function cached(platform, id) {
  const hit = cache.get(keyOf(platform, id));
  if (hit && hit.expires > Date.now()) return hit;
  cache.delete(keyOf(platform, id));
  return null;
}

// A profile, or null when the platform can't say (unknown ID, rate limit, outage). A miss is
// not cached, so the next page load asks again.
async function getProfile(platform, id, token) {
  const hit = cached(platform, String(id));
  if (hit) return hit.profile;
  const profile = await platforms.getUserById(platform, String(id), token);
  if (profile) remember(platform, String(id), profile);
  return profile;
}

// Profiles for many users of one platform, as a Map of id -> profile or null.
async function getProfiles(platform, ids, token) {
  const unique = [...new Set(ids.map(String))];
  const found = await Promise.all(unique.map((id) => getProfile(platform, id, token)));
  return new Map(unique.map((id, i) => [id, found[i]]));
}

// { login, name, avatarUrl } for a user, with the numeric ID as the login when the platform
// gave no answer.
function describe(id, profile) {
  return profile ? { login: profile.login, name: profile.name, avatarUrl: profile.avatarUrl } : { login: String(id), name: null, avatarUrl: null };
}

function clear() {
  cache.clear();
}

module.exports = { getProfile, getProfiles, describe, remember, clear, TTL_MS };
