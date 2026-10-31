// Asks GitHub or GitLab, with the signed-in user's own token, who the user is and what they
// own. Nothing here is cached or stored: roles are checked live on every org change.
const axios = require('axios');
const config = require('../config');
const github = require('./githubService');
const { HttpError } = require('../errors');

const PLATFORMS = ['github', 'gitlab'];
const GITLAB_OWNER = 50;
const PER_PAGE = 100;

function client(platform, token) {
  const baseURL = platform === 'github' ? config.github.apiUrl : config.gitlab.apiUrl;
  const headers = { Authorization: `Bearer ${token}` };
  if (platform === 'github') {
    headers.Accept = 'application/vnd.github+json';
    headers['X-GitHub-Api-Version'] = '2022-11-28';
  }
  return axios.create({ baseURL, headers, timeout: 15_000 });
}

function status(err) {
  return err.response && err.response.status;
}

// A rejected user token is the caller's problem (401); anything else is ours (502).
function platformError(platform, err) {
  if (status(err) === 401) return new HttpError(401, `${platform} rejected the token`);
  return new HttpError(502, `${platform} API error: ${err.message}`);
}

async function paginate(api, url, params) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const { data } = await api.get(url, { params: { ...params, per_page: PER_PAGE, page } });
    items.push(...data);
    if (data.length < PER_PAGE) return items;
  }
}

function sameName(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

async function getUser(platform, token) {
  try {
    const { data } = await client(platform, token).get('/user');
    return { platform, id: String(data.id), login: platform === 'github' ? data.login : data.username };
  } catch (err) {
    throw platformError(platform, err);
  }
}

// Orgs (GitHub) or top-level groups (GitLab) the user owns, plus their personal namespace,
// which they always own.
async function listOwnedOrgs(platform, token, user) {
  const api = client(platform, token);
  try {
    if (platform === 'github') {
      const memberships = await paginate(api, '/user/memberships/orgs', { state: 'active' });
      const owned = memberships.filter((m) => m.role === 'admin').map((m) => ({ name: m.organization.login, kind: 'org' }));
      return [{ name: user.login, kind: 'user' }, ...owned];
    }
    const groups = await paginate(api, '/groups', { min_access_level: GITLAB_OWNER, top_level_only: true });
    return [{ name: user.login, kind: 'user' }, ...groups.map((g) => ({ name: g.full_path, kind: 'org' }))];
  } catch (err) {
    throw platformError(platform, err);
  }
}

async function isOwner(platform, token, user, orgName) {
  if (sameName(orgName, user.login)) return true;
  const api = client(platform, token);
  try {
    if (platform === 'github') {
      const { data } = await api.get(`/user/memberships/orgs/${encodeURIComponent(orgName)}`);
      return data.state === 'active' && data.role === 'admin';
    }
    const { data } = await api.get(`/groups/${encodeURIComponent(orgName)}/members/all/${user.id}`);
    return data.access_level >= GITLAB_OWNER;
  } catch (err) {
    if ([403, 404].includes(status(err))) return false;
    throw platformError(platform, err);
  }
}

// GitHub only: the App installation on an org or user account, or null if not installed.
async function findGithubInstallation(name, kind) {
  const path = kind === 'user' ? `/users/${encodeURIComponent(name)}/installation` : `/orgs/${encodeURIComponent(name)}/installation`;
  try {
    const { data } = await axios.get(`${config.github.apiUrl}${path}`, {
      headers: { Authorization: `Bearer ${github.appJwt()}`, Accept: 'application/vnd.github+json' },
      timeout: 15_000,
    });
    return String(data.id);
  } catch (err) {
    if (status(err) === 404) return null;
    throw new HttpError(502, `github App API error: ${err.message}`);
  }
}

module.exports = { PLATFORMS, getUser, listOwnedOrgs, isOwner, findGithubInstallation };
