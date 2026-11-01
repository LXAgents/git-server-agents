const axios = require('axios');
require('../../http');
const config = require('../../config');

function client() {
  if (!config.gitlab.token) throw new Error('GITLAB_TOKEN is required');
  return axios.create({ baseURL: config.gitlab.apiUrl, headers: { 'PRIVATE-TOKEN': config.gitlab.token } });
}

// Rebuilds a unified diff from the merge request's per-file diffs; no clone involved.
async function getMergeRequestDiff(projectId, iid) {
  const api = client();
  const perPage = 100;
  const parts = [];
  for (let page = 1; ; page += 1) {
    const { data } = await api.get(`/projects/${encodeURIComponent(projectId)}/merge_requests/${iid}/diffs`, {
      params: { page, per_page: perPage },
    });
    for (const file of data) {
      parts.push(`diff --git a/${file.old_path} b/${file.new_path}\n--- a/${file.old_path}\n+++ b/${file.new_path}\n${file.diff}`);
    }
    if (data.length < perPage) break;
  }
  return parts.join('\n');
}

async function postNote(projectId, kind, iid, body) {
  const noteable = kind === 'pull_request' ? 'merge_requests' : 'issues';
  const { data } = await client().post(`/projects/${encodeURIComponent(projectId)}/${noteable}/${iid}/notes`, { body });
  return data;
}

const project = (projectId) => `/projects/${encodeURIComponent(projectId)}`;
const noteablePath = (kind) => (kind === 'pull_request' ? 'merge_requests' : 'issues');

// Marks a note as picked up with an award emoji.
async function awardEmoji(projectId, kind, iid, noteId, name = 'eyes') {
  await client().post(`${project(projectId)}/${noteablePath(kind)}/${iid}/notes/${noteId}/award_emoji`, { name });
}

// The newest `limit` notes on an issue or merge request, returned oldest first. System notes
// ("added 1 commit", "changed the label") are not conversation and are dropped.
async function listNotes(projectId, kind, iid, { limit = 30 } = {}) {
  const { data } = await client().get(`${project(projectId)}/${noteablePath(kind)}/${iid}/notes`, {
    params: { sort: 'desc', order_by: 'created_at', per_page: limit },
  });
  return data
    .filter((n) => !n.system)
    .reverse()
    .map((n) => ({
      id: n.id,
      author: (n.author && n.author.username) || '',
      isBot: (n.author && n.author.bot) || false,
      body: n.body || '',
    }));
}

// Every file path at `ref`, from the repository tree API, up to `maxPages` pages.
async function getRepoTree(projectId, ref, { maxPages = 20 } = {}) {
  const api = client();
  const perPage = 100;
  const paths = [];
  let truncated = false;
  for (let page = 1; ; page += 1) {
    const { data } = await api.get(`${project(projectId)}/repository/tree`, {
      params: { ref, recursive: true, per_page: perPage, page },
    });
    paths.push(...data.filter((e) => e.type === 'blob').map((e) => e.path));
    if (data.length < perPage) break;
    if (page >= maxPages) {
      truncated = true;
      break;
    }
  }
  return { paths, truncated };
}

// Raw file content at `ref`, or null when the path does not exist there.
async function getFileContent(projectId, path, ref) {
  try {
    const { data } = await client().get(`${project(projectId)}/repository/files/${encodeURIComponent(path)}/raw`, {
      params: { ref },
      responseType: 'text',
      transformResponse: (raw) => raw,
    });
    return data;
  } catch (err) {
    if (err.response && err.response.status === 404) return null;
    throw err;
  }
}

// Whether the user belongs to the top-level group (any access level, inherited included).
async function isGroupMember(group, userId) {
  try {
    const { data } = await client().get(`/groups/${encodeURIComponent(group)}/members/all/${encodeURIComponent(userId)}`);
    return Boolean(data && data.id !== undefined && String(data.id) === String(userId)) && data.state !== 'blocked';
  } catch (err) {
    if (err.response && err.response.status === 404) return false;
    throw err;
  }
}

// GitLab answers 404 for a group that does not exist, which is how a personal namespace looks.
async function groupExists(group) {
  try {
    await client().get(`/groups/${encodeURIComponent(group)}`, { params: { with_projects: false } });
    return true;
  } catch (err) {
    if (err.response && err.response.status === 404) return false;
    throw err;
  }
}

// The user's access level on the project (inherited included), or 0. 30 is Developer.
async function getMemberAccessLevel(projectId, userId) {
  try {
    const { data } = await client().get(`${project(projectId)}/members/all/${encodeURIComponent(userId)}`);
    if (!data || String(data.id) !== String(userId) || data.state === 'blocked') return 0;
    return Number(data.access_level) || 0;
  } catch (err) {
    if (err.response && err.response.status === 404) return 0;
    throw err;
  }
}

// Whether the user is a member of the project (any access level, inherited included).
async function isProjectMember(projectId, userId) {
  return (await getMemberAccessLevel(projectId, userId)) > 0;
}

// An issue or merge request. GitLab says "opened" where GitHub says "open"; the agent always
// sees "open".
const issueOf = (data) => ({ number: data.iid, url: data.web_url, state: data.state === 'opened' ? 'open' : data.state });

async function createIssue(projectId, { title, body, labels }) {
  const { data } = await client().post(`${project(projectId)}/issues`, {
    title,
    description: body,
    ...(labels ? { labels: labels.join(',') } : {}),
  });
  return issueOf(data);
}

// state is "open" or "closed", as on GitHub; GitLab takes a state_event.
async function setIssueState(projectId, iid, state) {
  const { data } = await client().put(`${project(projectId)}/issues/${iid}`, { state_event: state === 'closed' ? 'close' : 'reopen' });
  return issueOf(data);
}

// A merge request from `head` (source branch) into `base` (target branch). GitLab marks a
// draft by the "Draft:" title prefix.
async function createMergeRequest(projectId, { title, body, head, base, draft }) {
  const { data } = await client().post(`${project(projectId)}/merge_requests`, {
    title: draft ? `Draft: ${title}` : title,
    description: body,
    source_branch: head,
    target_branch: base,
  });
  return issueOf(data);
}

async function setMergeRequestState(projectId, iid, state) {
  const { data } = await client().put(`${project(projectId)}/merge_requests/${iid}`, { state_event: state === 'closed' ? 'close' : 'reopen' });
  return issueOf(data);
}

const stateOf = (state) => (state === 'opened' ? 'open' : state);

async function getIssue(projectId, iid) {
  const { data } = await client().get(`${project(projectId)}/issues/${iid}`);
  return {
    number: data.iid,
    title: data.title || '',
    state: stateOf(data.state),
    author: (data.author && data.author.username) || '',
    labels: data.labels || [],
    body: data.description || '',
    url: data.web_url,
    isPull: false,
  };
}

async function getMergeRequest(projectId, iid) {
  const { data } = await client().get(`${project(projectId)}/merge_requests/${iid}`);
  return {
    number: data.iid,
    title: data.title || '',
    state: stateOf(data.state),
    author: (data.author && data.author.username) || '',
    labels: data.labels || [],
    body: data.description || '',
    url: data.web_url,
    head: data.source_branch || '',
    base: data.target_branch || '',
  };
}

// A merge request's commits, oldest first (GitLab lists them newest first).
async function listMergeRequestCommits(projectId, iid, { maxPages = 3 } = {}) {
  const commits = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const { data } = await client().get(`${project(projectId)}/merge_requests/${iid}/commits`, { params: { per_page: 100, page } });
    commits.push(...data);
    if (data.length < 100) break;
  }
  return commits.reverse().map((c) => ({ sha: c.id, title: c.title || '', author: c.author_name || '' }));
}

async function getCommit(projectId, sha) {
  const api = client();
  const base = `${project(projectId)}/repository/commits/${encodeURIComponent(sha)}`;
  const [{ data }, { data: files }] = await Promise.all([api.get(base), api.get(`${base}/diff`, { params: { per_page: 100 } })]);
  const diff = files.map((f) => `diff --git a/${f.old_path} b/${f.new_path}\n--- a/${f.old_path}\n+++ b/${f.new_path}\n${f.diff}`).join('\n');
  return { sha: data.id, message: data.message || data.title || '', author: data.author_name || '', diff };
}

module.exports = {
  getMemberAccessLevel,
  createIssue,
  setIssueState,
  createMergeRequest,
  setMergeRequestState,
  getIssue,
  getMergeRequest,
  listMergeRequestCommits,
  getCommit,
  awardEmoji,
  isProjectMember,
  getMergeRequestDiff,
  postNote,
  listNotes,
  getRepoTree,
  getFileContent,
  isGroupMember,
  groupExists,
};
