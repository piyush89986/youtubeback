const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const connectDB = require('./config/db');
const logger = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorMiddleware');
const { apiLimiter } = require('./middleware/rateLimiter');

// Import routes
const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

const app = express();

// Trust reverse proxy (Render, AWS ELB, Heroku) to preserve client IP & HTTPS status
app.set('trust proxy', 1);

// Security middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// Allowed origins whitelist for CORS
const explicitOrigins = [
  'https://youtubfr.vercel.app',
  'https://youtubeback-osll.onrender.com',
  'https://youtube-worker-jkjs.onrender.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://localhost:5000',
];

if (env.CLIENT_URL) {
  const customOrigins = env.CLIENT_URL.split(',').map((u) => u.trim().replace(/\/+$/, ''));
  customOrigins.forEach((u) => {
    if (u && !explicitOrigins.includes(u)) {
      explicitOrigins.push(u);
    }
  });
}

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser calls (like curl, Postman, mobile apps, server-to-server, Render health check)
    if (!origin) return callback(null, true);

    const cleanOrigin = origin.replace(/\/+$/, '');

    // Check exact whitelist
    if (explicitOrigins.includes(cleanOrigin)) {
      return callback(null, true);
    }

    // Allow all Vercel domains (production & preview branch deployments)
    if (/\.vercel\.app$/.test(cleanOrigin)) {
      return callback(null, true);
    }

    // Allow all OnRender domains within the deployment ecosystem
    if (/\.onrender\.com$/.test(cleanOrigin)) {
      return callback(null, true);
    }

    logger.warn(`[CORS] Blocked request from unlisted origin: ${origin}`);
    return callback(new Error(`CORS blocked origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Range', 'Accept'],
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Set-Cookie'],
};

// CORS configuration
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Body and Cookie Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Serve local static video uploads
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Rate limiter for general API routes
app.use('/api', apiLimiter);

// Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: env.NODE_ENV,
  });
});

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Lazy mount placeholder handlers for upcoming phases until their controllers are wired
app.use('/api/youtube', (req, res, next) => {
  try {
    const youtubeRoutes = require('./routes/youtubeRoutes');
    return youtubeRoutes(req, res, next);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      return res.status(501).json({ success: false, message: 'YouTube module initialization in progress' });
    }
    next(err);
  }
});

app.use('/api/videos', (req, res, next) => {
  try {
    const videoRoutes = require('./routes/videoRoutes');
    return videoRoutes(req, res, next);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      return res.status(501).json({ success: false, message: 'Video module initialization in progress' });
    }
    next(err);
  }
});

app.use('/api/clips', (req, res, next) => {
  try {
    const clipRoutes = require('./routes/clipRoutes');
    return clipRoutes(req, res, next);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      return res.status(501).json({ success: false, message: 'Clips module initialization in progress' });
    }
    next(err);
  }
});

app.use('/api/schedules', (req, res, next) => {
  try {
    const scheduleRoutes = require('./routes/scheduleRoutes');
    return scheduleRoutes(req, res, next);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      return res.status(501).json({ success: false, message: 'Schedules module initialization in progress' });
    }
    next(err);
  }
});

// Centralized Error Handling
app.use(notFoundHandler);
app.use(errorHandler);

// Start Server after DB connection
const { startScheduler } = require('./services/schedulerService');

const startServer = async () => {
  await connectDB();
  startScheduler();
  const PORT = env.PORT;
  app.listen(PORT, () => {
    logger.info(`Server running in ${env.NODE_ENV} mode on port ${PORT}`);
    logger.info(`API Health check available at: http://localhost:${PORT}/api/health`);
  });
};

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

module.exports = app;
