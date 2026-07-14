const express = require('express');
const settingsController = require('../controllers/platformSettingsController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

// ── Public — storefront reads name, tagline, social links, policy URLs ────────
router.get('/', settingsController.getSettings);

// ── Admin only — initialise and update ───────────────────────────────────────
router.post('/', authenticate, authorize('admin'), settingsController.createSettings);
router.patch('/', authenticate, authorize('admin'), settingsController.updateSettings);

module.exports = router;
