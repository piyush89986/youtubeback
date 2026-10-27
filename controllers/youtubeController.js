const youtubeService = require('../services/youtube/youtubeService');
const YouTubeAccount = require('../models/YouTubeAccount');
const { apiSuccess, apiError } = require('../utils/apiResponse');
const env = require('../config/env');

// @desc    Get Google OAuth consent URL
// @route   GET /api/youtube/auth-url
// @access  Private
const getAuthUrl = (req, res, next) => {
  try {
    const url = youtubeService.getAuthUrl(req.user._id);
    return apiSuccess(res, { url }, 'OAuth URL generated');
  } catch (error) {
    next(error);
  }
};

// @desc    OAuth2 redirect callback
// @route   GET /api/youtube/oauth2callback
// @access  Public
const oauth2Callback = async (req, res, next) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect(`${env.CLIENT_URL}?oauth_error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      return res.redirect(`${env.CLIENT_URL}?oauth_error=missing_code_or_state`);
    }

    // Decode state
    const stateData = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
    const userId = stateData.userId;

    await youtubeService.handleOAuthCallback(code, userId);

    return res.redirect(`${env.CLIENT_URL}?tab=channels&connected=true`);
  } catch (err) {
    return res.redirect(`${env.CLIENT_URL}?oauth_error=${encodeURIComponent(err.message)}`);
  }
};

// @desc    Get user's connected YouTube channels
// @route   GET /api/youtube/channels
// @access  Private
const getConnectedChannels = async (req, res, next) => {
  try {
    const channels = await YouTubeAccount.find({
      user: req.user._id,
      isConnected: true,
    }).select('-encryptedAccessToken -encryptedRefreshToken');

    return apiSuccess(res, channels, 'Connected channels retrieved');
  } catch (error) {
    next(error);
  }
};

// @desc    Disconnect YouTube channel and revoke token
// @route   DELETE /api/youtube/channels/:channelId
// @access  Private
const disconnectChannel = async (req, res, next) => {
  try {
    const { channelId } = req.params;
    await youtubeService.revokeChannelAccess(channelId, req.user._id);
    return apiSuccess(res, null, 'Channel disconnected and permissions revoked');
  } catch (error) {
    next(error);
  }
};

// @desc    Test upload authorization with Google YouTube API
// @route   POST /api/youtube/test-upload
// @access  Private
const testUploadAuth = async (req, res, next) => {
  try {
    const { channelId } = req.body;
    if (!channelId) {
      return apiError(res, 'Channel ID is required', 400);
    }

    const { oauth2Client, account } = await youtubeService.getAuthenticatedClient(
      channelId,
      req.user._id
    );

    // Call youtube.channels.list with audit details to verify upload permission
    const { google } = require('googleapis');
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const check = await youtube.channels.list({
      part: ['status', 'contentDetails'],
      mine: true,
    });

    const isUploadAllowed = check.data.items && check.data.items.length > 0;

    return apiSuccess(
      res,
      {
        channelTitle: account.channelTitle,
        uploadPermissionVerified: isUploadAllowed,
        status: check.data.items?.[0]?.status || {},
      },
      `Channel "${account.channelTitle}" verified. OAuth credentials are live and ready to publish!`
    );
  } catch (error) {
    next(error);
  }
};

// @desc    Directly upload / publish a Short clip to YouTube immediately (skip scheduling)
// @route   POST /api/youtube/publish-now
// @access  Private
const publishNow = async (req, res, next) => {
  try {
    const { clipId, channelId, privacyStatus = 'public' } = req.body;

    if (!clipId) {
      return apiError(res, 'Clip ID is required', 400);
    }

    const ShortClip = require('../models/ShortClip');
    const clip = await ShortClip.findOne({ _id: clipId, user: req.user._id });
    if (!clip) {
      return apiError(res, 'Short clip not found', 404);
    }

    // Resolve channel: use specified channel or default to user's first connected channel
    let targetAccount = null;
    if (channelId) {
      targetAccount = await YouTubeAccount.findOne({
        _id: channelId,
        user: req.user._id,
        isConnected: true,
      });
    } else {
      targetAccount = await YouTubeAccount.findOne({
        user: req.user._id,
        isConnected: true,
      });
    }

    if (!targetAccount) {
      return apiError(
        res,
        'No connected YouTube channel found. Please connect your YouTube account in the Channels tab first.',
        400
      );
    }

    const crypto = require('crypto');
    const PublishingSchedule = require('../models/PublishingSchedule');
    const { uploadVideoToYouTube } = require('../services/schedulerService');
    const logger = require('../utils/logger');

    // Create an immediate publishing schedule record for audit trail & idempotency
    const idempotencyKey = `direct_${req.user._id}_${clip._id}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const schedule = await PublishingSchedule.create({
      user: req.user._id,
      clip: clip._id,
      youtubeAccount: targetAccount._id,
      scheduledTime: new Date(),
      privacyStatus,
      status: 'publishing',
      idempotencyKey,
    });

    clip.publishingStatus = 'publishing';
    await clip.save();

    logger.info(`[DirectPublish] Executing immediate YouTube upload for Short "${clip.title}" to channel "${targetAccount.channelTitle}"`);

    // Perform the direct YouTube upload immediately!
    const uploadResult = await uploadVideoToYouTube(schedule);

    // Update schedule record
    schedule.status = 'completed';
    schedule.completedAt = new Date();
    schedule.youtubeVideoId = uploadResult.youtubeVideoId;
    await schedule.save();

    // Update ShortClip record
    clip.publishingStatus = 'published';
    clip.publishedAt = new Date();
    clip.youtubeVideoId = uploadResult.youtubeVideoId;
    clip.youtubeUrl = uploadResult.youtubeUrl;
    await clip.save();

    logger.info(`[DirectPublish] SUCCESS! Video published to YouTube: ${uploadResult.youtubeUrl}`);

    return apiSuccess(
      res,
      {
        clip,
        schedule,
        youtubeVideoId: uploadResult.youtubeVideoId,
        youtubeUrl: uploadResult.youtubeUrl,
        channelTitle: targetAccount.channelTitle,
      },
      `Successfully published to YouTube channel "${targetAccount.channelTitle}"!`
    );
  } catch (error) {
    const logger = require('../utils/logger');
    const ShortClip = require('../models/ShortClip');
    logger.error(`[DirectPublish] Direct publish failed: ${error.message}`, error.stack);
    
    if (req.body.clipId) {
      try {
        await ShortClip.findByIdAndUpdate(req.body.clipId, {
          publishingStatus: 'failed',
          errorMessage: error.message,
        });
      } catch (e) {}
    }

    next(error);
  }
};

module.exports = {
  getAuthUrl,
  oauth2Callback,
  getConnectedChannels,
  disconnectChannel,
  testUploadAuth,
  publishNow,
};
