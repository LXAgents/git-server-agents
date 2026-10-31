const express = require('express');
const { userAuth } = require('../middleware/userAuth');
const user = require('../controllers/userController');
const repos = require('../controllers/repoController');

const router = express.Router();

router.use(userAuth);

router.get('/me', user.me);

// Model ids from OpenRouter, and the model each owner picked per modality.
router.get('/models', user.listModels);
router.get('/models/settings', user.getOwnModels);
router.put('/models/settings', user.setOwnModel);

router.get('/keys', user.listOwnKeys);
router.post('/keys', user.createOwnKey);
router.delete('/keys/:keyId', user.deleteOwnKey);

router.get('/orgs', user.listOrgs);
router.get('/orgs/importable', user.listImportable);
router.post('/orgs/import', user.importOrg);
router.delete('/orgs/:id', user.deleteOrg);

router.get('/orgs/:id/keys', user.listOrgKeys);
router.post('/orgs/:id/keys', user.createOrgKey);
router.delete('/orgs/:id/keys/:keyId', user.deleteOrgKey);
router.get('/orgs/:id/models', user.getOrgModels);
router.put('/orgs/:id/models', user.setOrgModel);

router.get('/repos', repos.listRepos);
router.get('/repos/importable', repos.listImportable);
router.post('/repos/import', repos.importRepo);
router.delete('/repos/:id', repos.deleteRepo);
router.get('/repos/:id/keys', repos.listRepoKeys);
router.post('/repos/:id/keys', repos.createRepoKey);
router.delete('/repos/:id/keys/:keyId', repos.deleteRepoKey);
router.get('/repos/:id/models', repos.getRepoModels);
router.put('/repos/:id/models', repos.setRepoModel);

module.exports = router;
