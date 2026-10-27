const express = require('express');
const router = express.Router();
const {
  createSchedule,
  listSchedules,
  pauseSchedule,
  resumeSchedule,
  cancelSchedule,
} = require('../controllers/scheduleController');
const { authenticate } = require('../middleware/authMiddleware');

router.post('/', authenticate, createSchedule);
router.get('/', authenticate, listSchedules);
router.patch('/:id/pause', authenticate, pauseSchedule);
router.patch('/:id/resume', authenticate, resumeSchedule);
router.delete('/:id', authenticate, cancelSchedule);

module.exports = router;
