const SourceVideo = require('../models/SourceVideo');
const ShortClip = require('../models/ShortClip');
const ProcessingJob = require('../models/ProcessingJob');
const { generateSignedUpload } = require('../services/storage/storageService');
const { apiSuccess, apiError } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');

// @desc    Generate signed upload URL and parameters for direct cloud upload
// @route   POST /api/videos/upload-signature
// @access  Private
const getUploadSignature = (req, res, next) => {
  try {
    const { filename, fileSize, contentType } = req.body;
    logger.info(`[VideoController:upload-signature] Request from User ID: ${req.user?._id || 'ANONYMOUS'}`);
    logger.info(`[VideoController:upload-signature] Request Body: filename="${filename}", fileSize=${fileSize} bytes, contentType="${contentType}"`);

    if (!filename) {
      logger.warn('[VideoController:upload-signature] Rejected: Filename is missing');
      return apiError(res, 'Filename is required', 400);
    }

    const signedData = generateSignedUpload(filename, contentType);
    logger.info(`[VideoController:upload-signature] Mode determined: "${signedData.uploadMode}", StorageKey: "${signedData.storageKey}", Endpoint: ${signedData.uploadUrl}`);

    return apiSuccess(res, signedData, 'Signed upload authorization generated');
  } catch (error) {
    logger.error(`[VideoController:upload-signature] Exception: ${error.message}`, error.stack);
    next(error);
  }
};

// @desc    Direct upload endpoint for local development without Cloudinary
// @route   POST /api/videos/upload-direct
// @access  Private
const uploadDirect = (req, res, next) => {
  try {
    logger.info(`[VideoController:upload-direct] Processing direct upload from User ID: ${req.user?._id}`);

    if (!req.file) {
      logger.error('[VideoController:upload-direct] Failed: req.file is undefined or empty');
      return apiError(res, 'No video file received', 400);
    }

    const publicUrl = `/uploads/${req.file.filename}`;
    logger.info(`[VideoController:upload-direct] SUCCESS: File stored at: ${req.file.path} (${(req.file.size / (1024 * 1024)).toFixed(2)} MB), Serving at: ${publicUrl}`);

    return apiSuccess(
      res,
      {
        url: publicUrl,
        key: req.file.filename,
        originalFilename: req.file.originalname,
        fileSize: req.file.size,
      },
      'Direct file stored'
    );
  } catch (error) {
    logger.error(`[VideoController:upload-direct] Exception: ${error.message}`, error.stack);
    next(error);
  }
};

// @desc    Confirm video upload completion & register in database
// @route   POST /api/videos/confirm
// @access  Private
const confirmUpload = async (req, res, next) => {
  try {
    const {
      title,
      originalFilename,
      fileSize,
      storageKey,
      storageUrl,
      clippingMode = 'ai_smart',
      targetDuration = 60,
      subtitlesEnabled = true,
    } = req.body;

    logger.info(`[VideoController:confirm] Received confirmation request from User: ${req.user?._id}`);
    logger.info(`[VideoController:confirm] Payload: Title="${title}", File="${originalFilename}", Size=${fileSize}, Key="${storageKey}", URL="${storageUrl}", Mode="${clippingMode}", TargetDuration=${targetDuration}s, SubtitlesEnabled=${subtitlesEnabled}`);

    if (!title || !storageKey || !storageUrl) {
      logger.warn('[VideoController:confirm] Validation failed: Missing required fields (title, storageKey, or storageUrl)');
      return apiError(res, 'Missing required video upload parameters (title, storageKey, storageUrl)', 400);
    }

    const isCloudinary = storageUrl.includes('cloudinary.com') || storageKey.startsWith('yt_source_videos/');
    const storageProvider = isCloudinary ? 'cloudinary' : 'local';

    const video = await SourceVideo.create({
      user: req.user._id,
      title: title.trim(),
      originalFilename: originalFilename || 'source_video.mp4',
      fileSize: fileSize || 0,
      storageProvider,
      storageKey,
      storageUrl,
      status: 'uploaded',
    });
    logger.info(`[VideoController:confirm] SourceVideo document created successfully: ID=${video._id}, Provider=${storageProvider}`);

    // Create background processing job record
    const job = await ProcessingJob.create({
      user: req.user._id,
      jobType: clippingMode === 'ai_smart' ? 'video_transcription' : 'clip_extraction',
      entityType: 'SourceVideo',
      entityId: video._id,
      status: 'queued',
      stage: 'Queued for clipping engine',
      payload: {
        clippingMode,
        targetDuration,
        subtitlesEnabled: Boolean(subtitlesEnabled),
      },
    });
    logger.info(`[VideoController:confirm] ProcessingJob document created: ID=${job._id}, Type=${job.jobType}`);

    // If in dev environment, trigger local queue worker asynchronously
    try {
      const { dispatchJob } = require('../services/queueService');
      logger.info(`[VideoController:confirm] Dispatching job ${job._id} to pipeline runner...`);
      dispatchJob(job._id);
    } catch (queueErr) {
      logger.warn(`[VideoController:confirm] Job dispatched with fallback worker warning: ${queueErr.message}`);
    }

    return apiSuccess(
      res,
      {
        video,
        jobId: job._id,
      },
      'Video registered and clipping job dispatched',
      201
    );
  } catch (error) {
    logger.error(`[VideoController:confirm] Exception during video registration: ${error.message}`, error.stack);
    next(error);
  }
};

// @desc    List all source videos for current user
// @route   GET /api/videos
// @access  Private
const listVideos = async (req, res, next) => {
  try {
    const videos = await SourceVideo.find({ user: req.user._id }).sort({ createdAt: -1 });
    return apiSuccess(res, videos, 'Videos retrieved');
  } catch (error) {
    next(error);
  }
};

// @desc    Get video details with its generated clips
// @route   GET /api/videos/:id
// @access  Private
const getVideoDetails = async (req, res, next) => {
  try {
    const video = await SourceVideo.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!video) {
      return apiError(res, 'Video not found', 404);
    }

    const clips = await ShortClip.find({
      sourceVideo: video._id,
      user: req.user._id,
    }).sort({ startTime: 1 });

    return apiSuccess(res, { video, clips });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete video and associated clips
// @route   DELETE /api/videos/:id
// @access  Private
const deleteVideo = async (req, res, next) => {
  try {
    const video = await SourceVideo.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!video) {
      return apiError(res, 'Video not found', 404);
    }

    await ShortClip.deleteMany({ sourceVideo: video._id });
    await SourceVideo.deleteOne({ _id: video._id });

    return apiSuccess(res, null, 'Video and generated clips deleted');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getUploadSignature,
  uploadDirect,
  confirmUpload,
  listVideos,
  getVideoDetails,
  deleteVideo,
};
