require('dotenv').config();

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 5000,
  CLIENT_URL: (process.env.CLIENT_URL || 'https://youtubfr.vercel.app').replace(/\/+$/, ''),

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
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || (
    process.env.NODE_ENV === 'production'
      ? 'https://youtubeback-osll.onrender.com/api/youtube/oauth2callback'
      : 'http://localhost:5000/api/youtube/oauth2callback'
  ),

  // Cloudinary Storage
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || 'ypuxmjhz',
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY || '351146714642611',
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET || 'xnWtWsvSktnT1n24vvWdKpcyn_Y',

  // AI Providers (Gemini / OpenAI)
  AI_PROVIDER: process.env.AI_PROVIDER || 'gemini', // 'gemini' | 'openai'
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',

  // Worker Service (Render Web Service Background Processor)
  WORKER_URL: (process.env.WORKER_URL || 'https://youtube-worker-t4xe.onrender.com').replace(/\/+$/, ''),
  INTERNAL_WORKER_SECRET: process.env.INTERNAL_WORKER_SECRET || 'shorts_internal_secure_worker_token_2026',

  // Limits
  MAX_UPLOAD_SIZE_MB: parseInt(process.env.MAX_UPLOAD_SIZE_MB, 10) || 500, // 500MB
  MAX_CLIP_DURATION_SEC: parseInt(process.env.MAX_CLIP_DURATION_SEC, 10) || 180, // YouTube Shorts max 180s
};

module.exports = env;
