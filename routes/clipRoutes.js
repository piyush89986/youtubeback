const express = require('express');
const router = express.Router();
const {
  listClips,
  getClipDetails,
  updateClipMetadata,
  generateClips,
  deleteClip,
  rerenderClip,
} = require('../controllers/clipController');
const { authenticate } = require('../middleware/authMiddleware');

router.get('/', authenticate, listClips);
router.get('/:id', authenticate, getClipDetails);
router.put('/:id', authenticate, updateClipMetadata);
router.post('/:id/rerender', authenticate, rerenderClip);
router.post('/generate', authenticate, generateClips);
router.delete('/:id', authenticate, deleteClip);

module.exports = router;
