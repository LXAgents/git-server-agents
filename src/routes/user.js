const express = require('express');
const { userAuth } = require('../middleware/userAuth');
const user = require('../controllers/userController');

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

module.exports = router;
