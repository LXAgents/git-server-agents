const express = require('express');
const controller = require('../controllers/webhookController');

const router = express.Router();

router.post('/github', controller.github);
router.post('/gitlab', controller.gitlab);

module.exports = router;
