const express = require('express');
const router = express.Router();
const {
  getAuthUrl,
  oauth2Callback,
  getConnectedChannels,
  disconnectChannel,
  testUploadAuth,
  publishNow,
} = require('../controllers/youtubeController');
const { authenticate } = require('../middleware/authMiddleware');

router.get('/auth-url', authenticate, getAuthUrl);
router.get('/oauth2callback', oauth2Callback);
router.get('/channels', authenticate, getConnectedChannels);
router.delete('/channels/:channelId', authenticate, disconnectChannel);
router.post('/test-upload', authenticate, testUploadAuth);
router.post('/publish-now', authenticate, publishNow);

module.exports = router;
