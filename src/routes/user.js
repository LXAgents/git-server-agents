const express = require('express');
const { userAuth } = require('../middleware/userAuth');
const user = require('../controllers/userController');
const repos = require('../controllers/repoController');
const workspaceKeys = require('../controllers/workspaceKeyController');

const router = express.Router();

router.use(userAuth);

router.get('/me', user.me);

// The AI providers, each provider's live model ids, and the provider and model each owner
// picked per modality.
router.get('/providers', user.listAiProviders);
router.get('/models', user.listModels);
router.get('/models/settings', user.getOwnModels);
router.put('/models/settings', user.setOwnModel);

router.get('/keys', user.listOwnKeys);
router.post('/keys', user.createOwnKey);
router.delete('/keys/:keyId', user.deleteOwnKey);

// Workspace keys: GitHub personal access tokens with the codespace scope, for the agent's
// workspace tools. Kept apart from the AI keys above.
router.get('/workspace-keys', workspaceKeys.listOwn);
router.post('/workspace-keys', workspaceKeys.createOwn);
router.delete('/workspace-keys/:keyId', workspaceKeys.deleteOwn);

router.get('/orgs', user.listOrgs);
router.get('/orgs/importable', user.listImportable);
router.post('/orgs/import', user.importOrg);
router.delete('/orgs/:id', user.deleteOrg);

router.get('/orgs/:id/keys', user.listOrgKeys);
router.post('/orgs/:id/keys', user.createOrgKey);
router.delete('/orgs/:id/keys/:keyId', user.deleteOrgKey);
router.get('/orgs/:id/models', user.getOrgModels);
router.put('/orgs/:id/models', user.setOrgModel);
router.get('/orgs/:id/workspace-keys', workspaceKeys.listOrg);
router.post('/orgs/:id/workspace-keys', workspaceKeys.createOrg);
router.delete('/orgs/:id/workspace-keys/:keyId', workspaceKeys.deleteOrg);

router.get('/repos', repos.listRepos);
router.get('/repos/importable', repos.listImportable);
router.post('/repos/import', repos.importRepo);
router.delete('/repos/:id', repos.deleteRepo);
router.get('/repos/:id/keys', repos.listRepoKeys);
router.post('/repos/:id/keys', repos.createRepoKey);
router.delete('/repos/:id/keys/:keyId', repos.deleteRepoKey);
router.get('/repos/:id/models', repos.getRepoModels);
router.put('/repos/:id/models', repos.setRepoModel);
router.get('/repos/:id/workspace-keys', workspaceKeys.listRepo);
router.post('/repos/:id/workspace-keys', workspaceKeys.createRepo);
router.delete('/repos/:id/workspace-keys/:keyId', workspaceKeys.deleteRepo);

module.exports = router;
