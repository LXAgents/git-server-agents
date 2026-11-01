const express = require('express');
const { userAuth } = require('../middleware/userAuth');
const chat = require('../controllers/chatController');

// The 3-room chat: user:{accountId}, repo:{repoId} and org:{orgId}. Signed in like /api/user,
// with the caller's own GitHub or GitLab OAuth token.
const router = express.Router();

router.use(userAuth);

router.get('/rooms', chat.listRooms);
router.get('/sessions', chat.listSessions);
router.post('/sessions', chat.createSession);
router.patch('/sessions/:id', chat.renameSession);
router.delete('/sessions/:id', chat.deleteSession);
router.get('/messages', chat.listMessages);
router.post('/messages', chat.postMessage);
router.get('/stream', chat.stream);

module.exports = router;
