const cloudinary = require('cloudinary').v2;
const crypto = require('crypto');
const env = require('../../config/env');
const logger = require('../../utils/logger');

// Configure Cloudinary if credentials provided
if (env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  logger.info('Cloudinary SDK configured for direct uploads');
}

/**
 * Generate signed upload parameters for client-side direct upload
 * Prevents routing 1-hour large video binaries through Express server memory!
 */
const generateSignedUpload = (filename, contentType) => {
  logger.info(`[StorageService] Generating signed upload request for file: "${filename}" (${contentType || 'unknown type'})`);
  const isCloudinaryReady = Boolean(
    env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET
  );

  const storageKey = `shorts_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;

  if (isCloudinaryReady) {
    logger.info(`[StorageService] Cloudinary active (Cloud: ${env.CLOUDINARY_CLOUD_NAME}). Creating signed direct upload credentials.`);
    const timestamp = Math.round(new Date().getTime() / 1000);
    const folder = 'yt_source_videos';

    // Generate Cloudinary SHA-1 signature
    const paramsToSign = {
      folder,
      public_id: storageKey,
      timestamp,
    };

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      env.CLOUDINARY_API_SECRET
    );

    const result = {
      uploadMode: 'cloudinary',
      uploadUrl: `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/video/upload`,
      uploadFields: {
        api_key: env.CLOUDINARY_API_KEY,
        timestamp,
        signature,
        folder,
        public_id: storageKey,
      },
      storageKey: `${folder}/${storageKey}`,
    };
    logger.info(`[StorageService] Signed upload ready for key: ${result.storageKey}`);
    return result;
  }

  // Fallback direct storage mode for local testing
  logger.info(`[StorageService] Cloudinary credentials not detected. Falling back to local direct upload mode.`);
  return {
    uploadMode: 'direct',
    uploadUrl: '/api/videos/upload-direct',
    uploadFields: {},
    storageKey,
  };
};

module.exports = {
  generateSignedUpload,
  cloudinary,
};
