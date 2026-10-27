const express = require('express');
const router = express.Router();
const { getDashboardStats } = require('../controllers/dashboardController');
const { authenticate } = require('../middleware/authMiddleware');

router.get('/stats', authenticate, getDashboardStats);

module.exports = router;
