const express = require('express');
const router = express.Router();
const { getDashboardStats, toggleWorkerStatus } = require('../controllers/dashboardController');
const { authenticate } = require('../middleware/authMiddleware');

router.get('/stats', authenticate, getDashboardStats);
router.patch('/worker-toggle', authenticate, toggleWorkerStatus);

module.exports = router;
