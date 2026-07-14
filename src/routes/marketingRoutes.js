const express = require('express');
const marketingController = require('../controllers/marketingController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

// ── Public — click/pixel tracking (no auth) ───────────────────────────────────
// Must be defined BEFORE the authenticate middleware group so it stays public.
router.post('/:id/track-click', marketingController.trackClick);
router.get('/:id/track-click', marketingController.trackClick); // GET for email pixel

// ── Protected — admin or marketing role required ──────────────────────────────
router.use(authenticate, authorize('admin', 'marketing'));

// CRUD
router.get('/', marketingController.getAllMessages);
router.get('/:id', marketingController.getMessage);
router.post('/', marketingController.createMessage);
router.patch('/:id', marketingController.updateMessage);
router.delete('/:id', marketingController.deleteMessage);

// Broadcast
router.post('/:id/send', marketingController.sendMessage);

module.exports = router;
