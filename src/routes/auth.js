const express = require('express');
const auth = require('../controllers/authController');

const router = express.Router();

router.get('/providers', auth.providers);
router.get('/:platform/start', auth.start);
router.get('/:platform/callback', auth.callback);
router.post('/exchange', auth.exchange);

module.exports = router;
