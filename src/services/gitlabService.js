const axios = require('axios');
const config = require('../config');

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

module.exports = { getMergeRequestDiff, postNote };
