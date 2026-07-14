const express = require('express');
const shippingController = require('../controllers/shippingController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

// ── Public — browse shipping options (price preview by city/state) ────────────
router.get('/', shippingController.getShippingOptions);

// ── Authenticated — apply shipping to own cart ────────────────────────────────
router.post('/apply', authenticate, shippingController.applyShippingToCart);

// ── Admin — manage shipping options ──────────────────────────────────────────
router.post('/', authenticate, authorize('admin'), shippingController.createShippingOption);
router.patch('/:id', authenticate, authorize('admin'), shippingController.updateShippingOption);
router.delete('/:id', authenticate, authorize('admin'), shippingController.deleteShippingOption);

module.exports = router;
