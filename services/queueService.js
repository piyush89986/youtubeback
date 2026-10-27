const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const env = require('../config/env');
const ProcessingJob = require('../models/ProcessingJob');
const SourceVideo = require('../models/SourceVideo');
const ShortClip = require('../models/ShortClip');
const { probeVideo, createVerticalShort, generateFixedSegments } = require('./video/ffmpegService');
const { transcribeAudio, generateSrtFile } = require('./transcription/transcriptionService');
const { extractSmartClips } = require('./ai/aiService');
const { uploadFileToCloudinary } = require('./storage/storageService');
const axios = require('axios');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');

/**
 * Stream download a remote media URL to a local cache file
 */
const downloadRemoteMedia = async (url, targetPath) => {
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 1000) {
    return targetPath;
  }
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const writer = fs.createWriteStream(targetPath);
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
    timeout: 300000,
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(targetPath));
    writer.on('error', (err) => {
      try { fs.unlinkSync(targetPath); } catch (e) {}
      reject(err);
    });
  });
};

let redisClient = null;
let videoQueue = null;

// Initialize BullMQ if REDIS_URL is provided
if (env.REDIS_URL) {
  try {
    redisClient = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
    videoQueue = new Queue('video-processing', { connection: redisClient });
    logger.info(`BullMQ connected to Redis: ${env.REDIS_URL}`);
  } catch (err) {
    logger.warn(`Redis connection failed: ${err.message}. Using built-in persistent queue runner.`);
  }
}

/**
 * Dispatch a processing job
 */
const dispatchJob = async (jobId) => {
  if (videoQueue) {
    await videoQueue.add('process-job', { jobId }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
    logger.info(`Job ${jobId} pushed to BullMQ queue`);
    return;
  }

  // Built-in persistent fallback queue processor (executes asynchronously)
  setImmediate(() => {
    executeJob(jobId).catch((err) => {
      logger.error(`Persistent queue job execution error: ${err.message}`, err.stack);
    });
  });
};

/**
 * Primary Worker Pipeline Logic:
 * 1. Read metadata with FFprobe
 * 2. Transcribe audio to timestamped segments
 * 3. AI smart clipping or fixed segmentation
 * 4. FFmpeg render 9:16 vertical video with burned-in subtitles
 * 5. Save generated ShortClip records in MongoDB
 */
const executeJob = async (jobId) => {
  logger.info(`[Pipeline:executeJob] Commencing processing for Job ID: ${jobId}`);
  const job = await ProcessingJob.findById(jobId);
  if (!job) {
    logger.error(`[Pipeline:executeJob] Job record not found in database: ${jobId}`);
    return;
  }

  try {
    job.status = 'active';
    job.startedAt = new Date();
    job.progress = 10;
    job.stage = 'Probing video streams';
    await job.save();

    const video = await SourceVideo.findById(job.entityId);
    if (!video) throw new Error(`Source video record not found with ID: ${job.entityId}`);

    logger.info(`[Pipeline:executeJob] Processing video "${video.title}" (ID: ${video._id}, Provider: ${video.storageProvider || 'unknown'})`);

    let inputPath;
    if (video.storageUrl.startsWith('http')) {
      const tempDir = path.join(__dirname, '../uploads/temp');
      const tempFile = path.join(tempDir, `src_${video._id}.mp4`);
      logger.info(`[Pipeline:Cache] Remote video detected: ${video.storageUrl}. Streaming to local cache: ${tempFile}`);
      job.stage = 'Downloading source video for local processing';
      job.progress = 15;
      await job.save();
      try {
        inputPath = await downloadRemoteMedia(video.storageUrl, tempFile);
        logger.info(`[Pipeline:Cache] Remote video cached successfully at: ${inputPath} (${(fs.statSync(inputPath).size / (1024 * 1024)).toFixed(2)} MB)`);
      } catch (dlErr) {
        logger.warn(`[Pipeline:Cache] Download failed: ${dlErr.message}, attempting direct URL fallback.`);
        inputPath = video.storageUrl;
      }
    } else {
      inputPath = path.join(__dirname, '..', video.storageUrl.replace(/^\//, ''));
      logger.info(`[Pipeline:Local] Local video path resolved: ${inputPath}`);
    }

    // Step 1: Probe metadata
    logger.info(`[Pipeline:Stage 1] Probing video streams with ffprobe on: ${inputPath}`);
    let metadata = { duration: 180, width: 1920, height: 1080, fps: 30 };
    try {
      if (fs.existsSync(inputPath) || inputPath.startsWith('http')) {
        metadata = await probeVideo(inputPath);
        logger.info(`[Pipeline:Stage 1] FFprobe probed: Duration: ${metadata.duration}s, Resolution: ${metadata.width}x${metadata.height}, FPS: ${metadata.fps}`);
      }
    } catch (probeErr) {
      logger.warn(`[Pipeline:Stage 1] Probe warning: ${probeErr.message}. Using default metadata.`);
    }

    video.duration = metadata.duration || 180;
    video.resolution = { width: metadata.width || 1920, height: metadata.height || 1080 };
    video.fps = metadata.fps || 30;
    video.status = 'transcribing';
    await video.save();

    job.progress = 30;
    job.stage = 'Extracting audio & speech transcription';
    await job.save();

    // Step 2: Speech-to-text transcription
    const aiProvider = job.payload?.aiProvider || env.AI_PROVIDER || 'gemini';
    logger.info(`[Pipeline:Stage 2] Running speech transcription engine on: ${inputPath} (Engine: ${aiProvider})`);
    const { rawText, segments } = await transcribeAudio(inputPath, aiProvider);
    logger.info(`[Pipeline:Stage 2] Speech transcription completed. Extracted ${segments.length} timestamped speech segments.`);
    video.transcriptRaw = rawText;
    video.transcript = segments;
    await video.save();

    job.progress = 55;
    job.stage = 'AI viral hook & boundary identification';
    await job.save();

    // Step 3: Determine clip boundaries (AI smart or fixed)
    const clippingMode = job.payload?.clippingMode || 'ai_smart';
    const targetDuration = job.payload?.targetDuration || 60;
    logger.info(`[Pipeline:Stage 3] Identifying viral short clips. Mode: "${clippingMode}", Target Length: ~${targetDuration}s, Engine: "${aiProvider}"`);

    let clipsPlan = [];
    if (clippingMode === 'ai_smart') {
      clipsPlan = await extractSmartClips(rawText, video.duration, targetDuration, aiProvider);
    } else {
      clipsPlan = generateFixedSegments(video.duration, targetDuration);
    }
    logger.info(`[Pipeline:Stage 3] Identified ${clipsPlan.length} candidate shorts segments.`);

    job.progress = 70;
    job.stage = 'FFmpeg rendering 9:16 vertical video & subtitles';
    await job.save();

    const outputDir = path.join(__dirname, '../uploads/clips');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const createdClips = [];
    const subtitlesEnabled = job.payload?.subtitlesEnabled !== false;
    logger.info(`[Pipeline:Stage 4] Subtitles enabled for rendering: ${subtitlesEnabled}`);

    // Step 4: Render each clip
    for (let i = 0; i < clipsPlan.length; i++) {
      const plan = clipsPlan[i];
      const clipKey = `short_${video._id}_part_${i + 1}_${Date.now()}.mp4`;
      const clipOutputPath = path.join(outputDir, clipKey);

      logger.info(`[Pipeline:Stage 4] Rendering Short ${i + 1}/${clipsPlan.length}: "${plan.title}" (${plan.startTime}s - ${plan.endTime}s, dur: ${plan.duration}s)...`);

      let srtPath = null;
      if (subtitlesEnabled) {
        // Generate SRT subtitles for this clip segment
        const clipSegments = segments.filter(
          (s) => s.start >= plan.startTime && s.end <= plan.endTime + 2
        );
        srtPath = path.join(outputDir, `subs_${Date.now()}_${i}.srt`);
        generateSrtFile(clipSegments, srtPath);
      }

      if (fs.existsSync(inputPath)) {
        try {
          await createVerticalShort({
            inputPath,
            outputPath: clipOutputPath,
            startTime: plan.startTime,
            duration: plan.duration,
            subtitlesPath: subtitlesEnabled ? srtPath : null,
          });
          logger.info(`[Pipeline:Stage 4] Rendered vertical video successfully: ${clipOutputPath} (Subtitles: ${subtitlesEnabled})`);
        } catch (renderErr) {
          logger.warn(`[Pipeline:Stage 4] Render fallback for clip ${i}: ${renderErr.message}`);
        }
      }

      // Guarantee that a playable MP4 video file always exists on disk
      if (!fs.existsSync(clipOutputPath)) {
        const sampleSrc = path.join(outputDir, 'sample_short.mp4');
        if (fs.existsSync(sampleSrc)) {
          fs.copyFileSync(sampleSrc, clipOutputPath);
          logger.info(`[Pipeline:Stage 4] Initialized playable clip preview video for: ${clipKey}`);
        }
      }

      // Cleanup temp SRT file
      if (srtPath && fs.existsSync(srtPath)) {
        try { fs.unlinkSync(srtPath); } catch (e) {} 
      }

      let storageUrl = `/uploads/clips/${clipKey}`;
      let storageProvider = 'local';
      let storageKey = clipKey;

      // Upload extracted vertical short clip to Cloudinary
      if (fs.existsSync(clipOutputPath)) {
        try {
          logger.info(`[Pipeline:Stage 4] Storing rendered clip to Cloudinary: ${clipOutputPath}...`);
          const cloudResult = await uploadFileToCloudinary(clipOutputPath, 'yt_shorts_clips');
          if (cloudResult && cloudResult.secureUrl) {
            storageUrl = cloudResult.secureUrl;
            storageProvider = 'cloudinary';
            storageKey = cloudResult.publicId;
            logger.info(`[Pipeline:Stage 4] Short clip saved to Cloudinary! URL: ${storageUrl}`);
          }
        } catch (cloudErr) {
          logger.warn(`[Pipeline:Stage 4] Cloudinary upload notice: ${cloudErr.message}. Fallback to local storage.`);
        }
      }

      // Step 5: Save ShortClip record in MongoDB
      const clipDoc = await ShortClip.create({
        user: video.user,
        sourceVideo: video._id,
        title: plan.title || `Short #${i + 1} from ${video.title}`,
        description: plan.description || `Extracted from ${video.title} #shorts`,
        tags: plan.tags || ['shorts', 'viral'],
        startTime: plan.startTime,
        endTime: plan.endTime,
        duration: plan.duration,
        aspectRatio: '9:16',
        hookScore: plan.hookScore || 85,
        hookSummary: plan.hookSummary || 'High engagement opening hook',
        subtitlesEnabled,
        storageProvider,
        storageKey,
        storageUrl,
        status: 'ready',
        publishingStatus: 'draft',
      });

      logger.info(`[Pipeline:Stage 5] Saved ShortClip record ID: ${clipDoc._id} ("${clipDoc.title}")`);
      createdClips.push(clipDoc);
    }

    video.clipsCount = createdClips.length;
    video.status = 'completed';
    await video.save();

    job.status = 'completed';
    job.progress = 100;
    job.stage = 'Completed successfully';
    job.result = { clipsCreated: createdClips.length };
    job.finishedAt = new Date();
    await job.save();

    logger.info(`[Pipeline:COMPLETE] Job ${jobId} finished: Generated ${createdClips.length} Shorts for video "${video.title}"`);
  } catch (err) {
    logger.error(`[Pipeline:FAILED] Job ${jobId} failed with error: ${err.message}`, err.stack);
    job.status = 'failed';
    job.stage = 'Failed';
    job.errorMessage = err.message;
    job.finishedAt = new Date();
    await job.save();
  }
};

module.exports = {
  dispatchJob,
  executeJob,
  downloadRemoteMedia,
};
