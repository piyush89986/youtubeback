const PublishingSchedule = require('../models/PublishingSchedule');
const ShortClip = require('../models/ShortClip');
const { apiSuccess, apiError } = require('../utils/apiResponse');
const crypto = require('crypto');

// @desc    Create a new publishing schedule
// @route   POST /api/schedules
// @access  Private
const createSchedule = async (req, res, next) => {
  try {
    const {
      clipId,
      youtubeAccountId,
      scheduledTime,
      timezone = 'UTC',
      privacyStatus = 'public',
      frequency = 'once',
    } = req.body;

    if (!clipId || !youtubeAccountId || !scheduledTime) {
      return apiError(res, 'Clip ID, YouTube account ID, and scheduled time are required', 400);
    }

    const clip = await ShortClip.findOne({ _id: clipId, user: req.user._id });
    if (!clip) {
      return apiError(res, 'Short clip not found', 404);
    }

    // Unique idempotency key to prevent double scheduling
    const idempotencyKey = `sched_${req.user._id}_${clipId}_${new Date(scheduledTime).getTime()}_${crypto.randomBytes(4).toString('hex')}`;

    const schedule = await PublishingSchedule.create({
      user: req.user._id,
      clip: clip._id,
      youtubeAccount: youtubeAccountId,
      scheduledTime: new Date(scheduledTime),
      timezone,
      privacyStatus,
      frequency,
      status: 'pending',
      idempotencyKey,
    });

    clip.publishingStatus = 'scheduled';
    clip.scheduledAt = new Date(scheduledTime);
    await clip.save();

    return apiSuccess(res, schedule, 'Publication scheduled successfully', 201);
  } catch (error) {
    next(error);
  }
};

// @desc    List all schedules for user
// @route   GET /api/schedules
// @access  Private
const listSchedules = async (req, res, next) => {
  try {
    const schedules = await PublishingSchedule.find({ user: req.user._id })
      .populate('clip', 'title duration storageUrl publishingStatus')
      .populate('youtubeAccount', 'channelTitle thumbnailUrl customUrl')
      .sort({ scheduledTime: 1 });

    return apiSuccess(res, schedules, 'Schedules retrieved');
  } catch (error) {
    next(error);
  }
};

// @desc    Pause a schedule
// @route   PATCH /api/schedules/:id/pause
// @access  Private
const pauseSchedule = async (req, res, next) => {
  try {
    const schedule = await PublishingSchedule.findOne({ _id: req.params.id, user: req.user._id });
    if (!schedule) return apiError(res, 'Schedule not found', 404);

    schedule.status = 'paused';
    await schedule.save();

    return apiSuccess(res, schedule, 'Schedule paused');
  } catch (error) {
    next(error);
  }
};

// @desc    Resume a paused schedule
// @route   PATCH /api/schedules/:id/resume
// @access  Private
const resumeSchedule = async (req, res, next) => {
  try {
    const schedule = await PublishingSchedule.findOne({ _id: req.params.id, user: req.user._id });
    if (!schedule) return apiError(res, 'Schedule not found', 404);

    schedule.status = 'pending';
    await schedule.save();

    return apiSuccess(res, schedule, 'Schedule resumed');
  } catch (error) {
    next(error);
  }
};

// @desc    Cancel a schedule
// @route   DELETE /api/schedules/:id
// @access  Private
const cancelSchedule = async (req, res, next) => {
  try {
    const schedule = await PublishingSchedule.findOne({ _id: req.params.id, user: req.user._id });
    if (!schedule) return apiError(res, 'Schedule not found', 404);

    await ShortClip.findByIdAndUpdate(schedule.clip, {
      publishingStatus: 'draft',
      scheduledAt: null,
    });

    await PublishingSchedule.deleteOne({ _id: schedule._id });

    return apiSuccess(res, null, 'Schedule cancelled');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createSchedule,
  listSchedules,
  pauseSchedule,
  resumeSchedule,
  cancelSchedule,
};
