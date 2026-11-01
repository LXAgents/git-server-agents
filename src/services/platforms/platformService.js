// Asks GitHub or GitLab, with the signed-in user's own token, who the user is and what they
// own. Nothing here is cached or stored: roles are checked live on every org change.
const axios = require('axios');
require('../../http');
const config = require('../../config');
const github = require('./githubService');
const { HttpError } = require('../../errors');

const PLATFORMS = ['github', 'gitlab'];
const GITLAB_OWNER = 50;
const PER_PAGE = 100;

function client(platform, token) {
  const baseURL = platform === 'github' ? config.github.apiUrl : config.gitlab.apiUrl;
  // Without a token the call is anonymous, which public profile lookups allow.
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
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

// The public profile fields both platforms return for a user object.
function profileOf(platform, data) {
  return {
    login: platform === 'github' ? data.login : data.username,
    name: data.name || null,
    avatarUrl: data.avatar_url || null,
  };
}

async function getUser(platform, token) {
  try {
    const { data } = await client(platform, token).get('/user');
    return { platform, id: String(data.id), ...profileOf(platform, data) };
  } catch (err) {
    throw platformError(platform, err);
  }
}

// Any user's public profile by numeric ID, or null when the platform can't say.
// GitHub: GET /user/{id}. GitLab: GET /users/{id}.
async function getUserById(platform, id, token) {
  // The ID goes into a URL path, so only a plain number is used.
  if (!/^\d+$/.test(String(id))) return null;
  try {
    const { data } = await client(platform, token).get(platform === 'github' ? `/user/${id}` : `/users/${id}`);
    return profileOf(platform, data);
  } catch {
    return null;
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

// The user's access to an imported repository right now, from their own token: "admin",
// "write", "read" or "none", plus its default branch. GitHub: the repository's permissions for
// the token. GitLab: the larger of the project and group access levels. Asked live, never stored.
async function repoAccess(platform, token, user, repo) {
  const api = client(platform, token);
  try {
    if (platform === 'github') {
      const [owner, name] = String(repo.fullName).split('/');
      const { data } = await api.get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
      if (String(data.id) !== String(repo.externalId)) return { level: 'none', defaultBranch: null };
      const p = data.permissions || {};
      let level = 'none';
      if (p.admin) level = 'admin';
      else if (p.push || p.maintain) level = 'write';
      else if (p.pull || p.triage) level = 'read';
      return { level, defaultBranch: data.default_branch || null };
    }
    const projectId = String(repo.externalId);
    if (!NUMERIC_ID.test(projectId)) return { level: 'none', defaultBranch: null };
    const { data } = await api.get(`/projects/${encodeURIComponent(projectId)}`);
    const perms = data.permissions || {};
    const access = Math.max((perms.project_access && perms.project_access.access_level) || 0, (perms.group_access && perms.group_access.access_level) || 0);
    let level = 'none';
    if (access >= GITLAB_MAINTAINER) level = 'admin';
    else if (access >= 30) level = 'write';
    else if (access >= 10) level = 'read';
    return { level, defaultBranch: data.default_branch || null };
  } catch (err) {
    if ([403, 404].includes(status(err))) return { level: 'none', defaultBranch: null };
    throw platformError(platform, err);
  }
}

// Whether the user is in the org right now (any role), from their own token. A personal
// account counts only for its owner.
async function isOrgMember(platform, token, user, orgName) {
  if (sameName(orgName, user.login)) return true;
  const api = client(platform, token);
  try {
    if (platform === 'github') {
      const { data } = await api.get(`/user/memberships/orgs/${encodeURIComponent(orgName)}`);
      return data.state === 'active';
    }
    const userId = String(user.id);
    if (!NUMERIC_ID.test(userId)) return false;
    const { data } = await api.get(`/groups/${encodeURIComponent(orgName)}/members/all/${encodeURIComponent(userId)}`);
    return Number(data.access_level) >= 10;
  } catch (err) {
    if ([403, 404].includes(status(err))) return false;
    throw platformError(platform, err);
  }
}

// GitHub only: every installation of the App, by "org:name" or "user:name" (lower case).
// The list is read from /app/installations, so no user-supplied name goes into a URL.
async function githubInstallations() {
  const api = axios.create({
    baseURL: config.github.apiUrl,
    headers: { Authorization: `Bearer ${github.appJwt()}`, Accept: 'application/vnd.github+json' },
    timeout: 15_000,
  });
  try {
    const items = await paginate(api, '/app/installations', {});
    const byAccount = new Map();
    for (const i of items) {
      const account = i.account || {};
      const kind = account.type === 'User' ? 'user' : 'org';
      byAccount.set(`${kind}:${String(account.login).toLowerCase()}`, String(i.id));
    }
    return byAccount;
  } catch (err) {
    throw new HttpError(502, `github App API error: ${err.message}`);
  }
}

// GitHub only: the App installation on an org or user account, or null if not installed.
// Pass `installations` from githubInstallations() to look up many accounts with one list.
async function findGithubInstallation(name, kind, installations) {
  const byAccount = installations || (await githubInstallations());
  return byAccount.get(`${kind === 'user' ? 'user' : 'org'}:${String(name).toLowerCase()}`) || null;
}

module.exports = { PLATFORMS, getUser, getUserById, listOwnedOrgs, isOwner, listAdminRepos, isRepoAdmin, repoAccess, isOrgMember, githubInstallations, findGithubInstallation };
