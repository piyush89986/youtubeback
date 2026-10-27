require('dotenv').config();

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 5000,
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',

  // Database
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/yt_shorts_automation',

  // Redis / Queue
  REDIS_URL: process.env.REDIS_URL || '',

  // JWT & Security
  JWT_SECRET: process.env.JWT_SECRET || 'dev_jwt_secret_super_secure_key_change_in_production_32b',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', // 32 bytes hex

  // Google OAuth & YouTube API
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/youtube/oauth2callback',

  // Cloudinary Storage
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || '',
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY || '',
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET || '',

  // AI Providers (Gemini / OpenAI)
  AI_PROVIDER: process.env.AI_PROVIDER || 'gemini', // 'gemini' | 'openai'
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',

  // Limits
  MAX_UPLOAD_SIZE_MB: parseInt(process.env.MAX_UPLOAD_SIZE_MB, 10) || 500, // 500MB
  MAX_CLIP_DURATION_SEC: parseInt(process.env.MAX_CLIP_DURATION_SEC, 10) || 180, // YouTube Shorts max 180s
};

module.exports = env;
