# 1.6.0 — 2026-10-31

Users, orgs and repositories can each store a model and OpenRouter keys, so comments don't
have to name a model. Pairs with git-client-agents 1.5.0. Works on GitHub and GitLab.

## Added

- **`@agents` on line 1** uses the stored model: the repository's, then the org's, then the
  commenting user's, then `DEFAULT_MODEL` (`openrouter/free`). `@vendor/model` still picks a
  specific model. The question can now follow on the same line.
- **Repositories:**
  - Admins (GitHub `admin`, GitLab Maintainer or above) import them from imported orgs.
  - Each one can have its own keys and model.
  - New `/api/user/repos…` routes, plus `GET` and `DELETE /api/admin/repos`.
- **Models per modality** for users, orgs and repositories:
  - The nine modalities are text, image, video, speech, decisions, embeddings, rerank,
    transcription and audio. The agent uses text.
  - `GET /api/user/models?modality=text` returns OpenRouter's live model list, cached for
    5 minutes.
- `OPENROUTER_API_URL` setting.

## Changed

- **Key order is now repository, then org, then the commenting user.**
  - Repository keys need a collaborator, a project member or an org member.
  - Org keys still need an org member.
  - The user's own keys come last.
- CORS allows `PUT`.
- **Schema:** new `Repository` and `ModelSetting` tables, and `AccountKey.repositoryId`. The
  entrypoint's `db push` adds them.
