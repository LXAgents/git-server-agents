const express = require('express');
const { adminAuth } = require('../middleware/adminAuth');
const admin = require('../controllers/adminController');

const router = express.Router();

router.use(adminAuth);

router.get('/accounts', admin.listAccounts);
router.post('/accounts', admin.createAccount);
router.delete('/accounts/:platform/:userId', admin.deleteAccount);

// No POST: orgs are created by import only, through /api/user/orgs/import.
router.get('/orgs', admin.listOrgs);
router.delete('/orgs/:id', admin.deleteOrg);

router.get('/repos', admin.listRepos);
router.delete('/repos/:id', admin.deleteRepo);

router.get('/keys', admin.listKeys);
router.post('/keys', admin.createKey);
router.delete('/keys/:id', admin.deleteKey);

module.exports = router;
