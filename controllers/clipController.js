const path = require('path');
const fs = require('fs');
const ShortClip = require('../models/ShortClip');
const SourceVideo = require('../models/SourceVideo');
const ProcessingJob = require('../models/ProcessingJob');
const { apiSuccess, apiError } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { createVerticalShort } = require('../services/video/ffmpegService');
const { generateSrtFile } = require('../services/transcription/transcriptionService');
const { downloadRemoteMedia } = require('../services/queueService');

// @desc    List all generated clips for current user
// @route   GET /api/clips
// @access  Private
const listClips = async (req, res, next) => {
  try {
    const { status, sourceVideoId } = req.query;
    const filter = { user: req.user._id };

    if (status && status !== 'all') {
      filter.publishingStatus = status;
    }
    if (sourceVideoId) {
      filter.sourceVideo = sourceVideoId;
    }

    const clips = await ShortClip.find(filter)
      .populate('sourceVideo', 'title duration')
      .sort({ createdAt: -1 });

    return apiSuccess(res, clips, 'Clips retrieved');
  } catch (error) {
    next(error);
  }
};

// @desc    Get single clip details
// @route   GET /api/clips/:id
// @access  Private
const getClipDetails = async (req, res, next) => {
  try {
    const clip = await ShortClip.findOne({
      _id: req.params.id,
      user: req.user._id,
    }).populate('sourceVideo', 'title duration originalFilename');

    if (!clip) {
      return apiError(res, 'Clip not found', 404);
    }

    return apiSuccess(res, clip, 'Clip details retrieved');
  } catch (error) {
    next(error);
  }
};

// @desc    Update clip metadata (Title, Description, Tags, Subtitle Style)
// @route   PUT /api/clips/:id
// @access  Private
const updateClipMetadata = async (req, res, next) => {
  try {
    const { title, description, tags, subtitleStyle, subtitlesEnabled } = req.body;
    const clip = await ShortClip.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!clip) {
      return apiError(res, 'Clip not found', 404);
    }

    if (title) clip.title = title.trim().substring(0, 100);
    if (description !== undefined) clip.description = description.substring(0, 5000);
    if (tags !== undefined) clip.tags = tags;
    if (subtitleStyle) clip.subtitleStyle = { ...clip.subtitleStyle, ...subtitleStyle };
    if (subtitlesEnabled !== undefined) clip.subtitlesEnabled = Boolean(subtitlesEnabled);

    await clip.save();

    return apiSuccess(res, clip, 'Clip metadata updated');
  } catch (error) {
    next(error);
  }
};

// @desc    Trigger AI or fixed clipping for a source video
// @route   POST /api/clips/generate
// @access  Private
const generateClips = async (req, res, next) => {
  try {
    const { sourceVideoId, clippingMode = 'ai_smart', targetDuration = 60 } = req.body;

    const video = await SourceVideo.findOne({
      _id: sourceVideoId,
      user: req.user._id,
    });

    if (!video) {
      return apiError(res, 'Source video not found', 404);
    }

    // Create and dispatch processing job
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
      },
    });

    try {
      const { dispatchJob } = require('../services/queueService');
      dispatchJob(job._id);
    } catch (e) {}

    return apiSuccess(res, { jobId: job._id }, 'Clipping process queued');
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a clip
// @route   DELETE /api/clips/:id
// @access  Private
const deleteClip = async (req, res, next) => {
  try {
    const clip = await ShortClip.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!clip) {
      return apiError(res, 'Clip not found', 404);
    }

    await ShortClip.deleteOne({ _id: clip._id });
    await SourceVideo.updateOne({ _id: clip.sourceVideo }, { $inc: { clipsCount: -1 } });

    return apiSuccess(res, null, 'Clip deleted');
  } catch (error) {
    next(error);
  }
};

// @desc    Re-render clip with or without burned-in subtitles
// @route   POST /api/clips/:id/rerender
// @access  Private
const rerenderClip = async (req, res, next) => {
  try {
    const { subtitlesEnabled } = req.body;
    const clip = await ShortClip.findOne({
      _id: req.params.id,
      user: req.user._id,
    }).populate('sourceVideo');

    if (!clip) {
      return apiError(res, 'Clip not found', 404);
    }

    const targetSubtitles = subtitlesEnabled !== undefined ? Boolean(subtitlesEnabled) : false;
    clip.subtitlesEnabled = targetSubtitles;

    const video = clip.sourceVideo;
    if (!video) {
      return apiError(res, 'Source video not found for this clip', 404);
    }

    logger.info(`[rerenderClip] Re-rendering clip "${clip.title}" (ID: ${clip._id}), subtitlesEnabled: ${targetSubtitles}`);

    // Resolve source video path
    const tempDir = path.join(__dirname, '../uploads/temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const cachedFile = path.join(tempDir, `src_${video._id}.mp4`);
    let inputPath = cachedFile;

    if (!fs.existsSync(inputPath)) {
      if (video.storageUrl && video.storageUrl.startsWith('http')) {
        logger.info(`[rerenderClip] Downloading remote media to cache: ${cachedFile}`);
        inputPath = await downloadRemoteMedia(video.storageUrl, cachedFile);
      } else if (video.storageUrl) {
        inputPath = path.join(__dirname, '..', video.storageUrl.replace(/^\//, ''));
      }
    }

    if (!fs.existsSync(inputPath)) {
      return apiError(res, 'Source video file is not accessible for re-rendering', 400);
    }

    // Determine output file path
    const clipKey = clip.storageKey || path.basename(clip.storageUrl);
    const outputDir = path.join(__dirname, '../uploads/clips');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, clipKey);

    let srtPath = null;
    if (targetSubtitles) {
      const segments = video.metadata?.transcriptSegments || [];
      if (segments.length > 0) {
        srtPath = path.join(tempDir, `rerender_${clip._id}_${Date.now()}.srt`);
        await generateSrtFile(segments, srtPath, clip.startTime, clip.endTime);
      }
    }

    await createVerticalShort({
      inputPath,
      outputPath,
      startTime: clip.startTime,
      duration: clip.duration,
      subtitlesPath: srtPath,
    });

    if (srtPath && fs.existsSync(srtPath)) {
      try { fs.unlinkSync(srtPath); } catch (e) {}
    }

    // Upload re-rendered clip to Cloudinary if available
    try {
      const { uploadFileToCloudinary } = require('../services/storage/storageService');
      const cloudResult = await uploadFileToCloudinary(outputPath, 'yt_shorts_clips');
      if (cloudResult && cloudResult.secureUrl) {
        clip.storageUrl = cloudResult.secureUrl;
        clip.storageProvider = 'cloudinary';
        clip.storageKey = cloudResult.publicId;
        logger.info(`[rerenderClip] Re-rendered clip uploaded to Cloudinary: ${cloudResult.secureUrl}`);
      }
    } catch (cloudErr) {
      logger.warn(`[rerenderClip] Cloudinary upload notice: ${cloudErr.message}`);
    }

    clip.updatedAt = new Date();
    await clip.save();

    logger.info(`[rerenderClip] Re-render complete for clip ID: ${clip._id}`);
    return apiSuccess(res, clip, `Clip re-rendered successfully ${targetSubtitles ? 'with' : 'without'} subtitles`);
  } catch (error) {
    logger.error(`[rerenderClip] Error re-rendering clip: ${error.message}`, error.stack);
    next(error);
  }
};

module.exports = {
  listClips,
  getClipDetails,
  updateClipMetadata,
  generateClips,
  deleteClip,
  rerenderClip,
};
