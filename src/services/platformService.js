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
    // The ID comes from GitLab, but it still goes into a URL path: only a plain number is used.
    const userId = String(user.id);
    if (!/^[1-9]\d{0,18}$/.test(userId)) return false;
    const { data } = await api.get(`/groups/${encodeURIComponent(orgName)}/members/all/${encodeURIComponent(userId)}`);
    return data.access_level >= GITLAB_OWNER;
  } catch (err) {
    if ([403, 404].includes(status(err))) return false;
    throw platformError(platform, err);
  }
}

const GITLAB_MAINTAINER = 40;
const MAX_REPO_PAGES = 10;
const NUMERIC_ID = /^[1-9]\d{0,18}$/;

async function paginateCapped(api, url, params) {
  const items = [];
  for (let page = 1; page <= MAX_REPO_PAGES; page += 1) {
    const { data } = await api.get(url, { params: { ...params, per_page: PER_PAGE, page } });
    items.push(...data);
    if (data.length < PER_PAGE) break;
  }
  return items;
}

// Repositories (GitHub) or projects (GitLab) the user administers: GitHub admin permission,
// or GitLab Maintainer and above. `org` is the top-level owner or group.
async function listAdminRepos(platform, token) {
  const api = client(platform, token);
  try {
    if (platform === 'github') {
      const repos = await paginateCapped(api, '/user/repos', { affiliation: 'owner,collaborator,organization_member' });
      return repos
        .filter((r) => r.permissions && r.permissions.admin)
        .map((r) => ({ externalId: String(r.id), fullName: r.full_name, org: r.owner.login }));
    }
    const projects = await paginateCapped(api, '/projects', { membership: true, min_access_level: GITLAB_MAINTAINER, simple: true });
    return projects.map((p) => ({ externalId: String(p.id), fullName: p.path_with_namespace, org: p.path_with_namespace.split('/')[0] }));
  } catch (err) {
    throw platformError(platform, err);
  }
}

// Whether the user administers the repository right now. Asked live, never stored.
async function isRepoAdmin(platform, token, user, repo) {
  const api = client(platform, token);
  try {
    if (platform === 'github') {
      const [owner, name] = String(repo.fullName).split('/');
      const { data } = await api.get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
      return String(data.id) === String(repo.externalId) && Boolean(data.permissions && data.permissions.admin);
    }
    const projectId = String(repo.externalId);
    const userId = String(user.id);
    if (!NUMERIC_ID.test(projectId) || !NUMERIC_ID.test(userId)) return false;
    const { data } = await api.get(`/projects/${encodeURIComponent(projectId)}/members/all/${encodeURIComponent(userId)}`);
    return data.access_level >= GITLAB_MAINTAINER;
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

module.exports = { PLATFORMS, getUser, listOwnedOrgs, isOwner, listAdminRepos, isRepoAdmin, findGithubInstallation };
