const SourceVideo = require('../models/SourceVideo');
const ShortClip = require('../models/ShortClip');
const PublishingSchedule = require('../models/PublishingSchedule');
const ProcessingJob = require('../models/ProcessingJob');
const YouTubeAccount = require('../models/YouTubeAccount');
const { apiSuccess } = require('../utils/apiResponse');

// @desc    Get dashboard metrics, recent videos, upcoming schedule, and active jobs
// @route   GET /api/dashboard/stats
// @access  Private
const getDashboardStats = async (req, res, next) => {
  try {
    const userId = req.user._id;

    // Parallel count queries
    const [
      totalSourceVideos,
      totalShortClips,
      scheduledClips,
      publishedClips,
      failedJobs,
      activeJobs,
      connectedChannels,
      upcomingSchedules,
      recentSourceVideos,
      recentClips,
    ] = await Promise.all([
      SourceVideo.countDocuments({ user: userId }),
      ShortClip.countDocuments({ user: userId }),
      PublishingSchedule.countDocuments({ user: userId, status: { $in: ['pending', 'locked'] } }),
      ShortClip.countDocuments({ user: userId, publishingStatus: 'published' }),
      ProcessingJob.countDocuments({ user: userId, status: 'failed' }),
      ProcessingJob.find({ user: userId, status: { $in: ['queued', 'active'] } })
        .sort({ updatedAt: -1 })
        .limit(5),
      YouTubeAccount.find({ user: userId, isConnected: true })
        .select('channelId channelTitle thumbnailUrl customUrl subscriberCount videoCount'),
      PublishingSchedule.find({
        user: userId,
        status: { $in: ['pending', 'locked', 'publishing'] },
        scheduledTime: { $gte: new Date(Date.now() - 3600000) }, // from 1h ago onwards
      })
        .populate('clip', 'title duration storageUrl aspectRatio publishingStatus')
        .populate('youtubeAccount', 'channelTitle thumbnailUrl')
        .sort({ scheduledTime: 1 })
        .limit(10),
      SourceVideo.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(5),
      ShortClip.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(6),
    ]);

    const geminiKeyManager = require('../services/ai/geminiKeyManager');
    const openaiKeyManager = require('../services/ai/openaiKeyManager');

    return apiSuccess(res, {
      metrics: {
        totalSourceVideos,
        totalShortClips,
        scheduledClips,
        publishedClips,
        failedJobs,
        connectedChannelsCount: connectedChannels.length,
      },
      activeJobs,
      connectedChannels,
      upcomingSchedules,
      recentSourceVideos,
      recentClips,
      geminiKeyPool: geminiKeyManager.getPoolStatus(),
      openaiKeyPool: openaiKeyManager.getPoolStatus(),
      workerActive: req.user.settings?.workerActive !== false,
      autoSchedulerEnabled: req.user.settings?.autoSchedulerEnabled !== false,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Toggle Background Worker & Auto-Scheduler ON/OFF
// @route   PATCH /api/dashboard/worker-toggle
// @access  Private
const toggleWorkerStatus = async (req, res, next) => {
  try {
    const User = require('../models/User');
    const { backfillAutoSchedule } = require('../services/autoScheduleService');
    const userId = req.user._id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Toggle or explicitly set
    const currentActive = user.settings?.workerActive !== false;
    const nextState = req.body.workerActive !== undefined ? Boolean(req.body.workerActive) : !currentActive;

    user.settings = {
      ...user.settings,
      workerActive: nextState,
      autoSchedulerEnabled: nextState,
    };
    await user.save();

    let backfilledCount = 0;
    if (nextState) {
      // If toggled ON, immediately auto-schedule any draft clips waiting in library
      const backfillRes = await backfillAutoSchedule(userId);
      backfilledCount = backfillRes?.scheduledCount || 0;
    }

    return apiSuccess(
      res,
      {
        workerActive: nextState,
        autoSchedulerEnabled: nextState,
        backfilledCount,
      },
      nextState
        ? `Worker & Auto-Scheduler activated! ${backfilledCount > 0 ? `${backfilledCount} clips scheduled day-by-day.` : ''}`
        : 'Worker & Auto-Scheduler paused.'
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDashboardStats,
  toggleWorkerStatus,
};
