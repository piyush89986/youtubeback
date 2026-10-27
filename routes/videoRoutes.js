const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  getUploadSignature,
  uploadDirect,
  confirmUpload,
  listVideos,
  getVideoDetails,
  deleteVideo,
} = require('../controllers/videoController');
const { authenticate } = require('../middleware/authMiddleware');

const logger = require('../utils/logger');
const { apiError } = require('../utils/apiResponse');

// Request logger for all video routes
router.use((req, res, next) => {
  logger.info(`[VideoRouter] ${req.method} ${req.originalUrl} | Content-Type: ${req.headers['content-type'] || 'none'} | Length: ${req.headers['content-length'] || 0} bytes`);
  next();
});

// Configure local multer destination for direct uploads fallback
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    logger.info(`[Multer:Storage] Directing file "${file.originalname}" to storage folder: ${uploadDir}`);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const generatedFilename = uniqueSuffix + path.extname(file.originalname);
    logger.info(`[Multer:Filename] Mapped "${file.originalname}" -> "${generatedFilename}"`);
    cb(null, generatedFilename);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});

// Safe Multer upload middleware with comprehensive logging
const handleDirectUpload = (req, res, next) => {
  logger.info(`[Multer:DirectUpload] Commencing video binary stream reception...`);
  upload.single('video')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        logger.error(`[Multer:Error] Multer upload failed with code [${err.code}]: ${err.message}`, err);
        return apiError(res, `Upload error: ${err.message} (${err.code})`, 400);
      }
      logger.error(`[Multer:Error] Unexpected stream error: ${err.message}`, err.stack);
      return apiError(res, `File processing error: ${err.message}`, 500);
    }

    if (!req.file) {
      logger.warn(`[Multer:DirectUpload] Request finished without receiving a file in 'video' field`);
    } else {
      logger.info(`[Multer:DirectUpload] Video received successfully: "${req.file.originalname}" saved as "${req.file.filename}" (${(req.file.size / (1024 * 1024)).toFixed(2)} MB)`);
    }
    next();
  });
};

router.post('/upload-signature', authenticate, getUploadSignature);
router.post('/upload-direct', authenticate, handleDirectUpload, uploadDirect);
router.post('/confirm', authenticate, confirmUpload);
router.get('/', authenticate, listVideos);
router.get('/:id', authenticate, getVideoDetails);
router.delete('/:id', authenticate, deleteVideo);

module.exports = router;
