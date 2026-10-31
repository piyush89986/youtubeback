const express = require('express');
const router = express.Router();
const { getDashboardStats, toggleWorkerStatus, getWorkerHealthStatus } = require('../controllers/dashboardController');
const { authenticate } = require('../middleware/authMiddleware');

router.get('/stats', authenticate, getDashboardStats);
router.patch('/worker-toggle', authenticate, toggleWorkerStatus);
router.get('/worker-status', authenticate, getWorkerHealthStatus);

module.exports = router;
