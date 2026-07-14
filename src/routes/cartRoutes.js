const express = require('express');
const cartController = require('../controllers/cartController');
const authenticate = require('../middleware/authenticate');

const router = express.Router();

// All cart routes require authentication.
router.use(authenticate);

// ── Cart ──────────────────────────────────────────────────────────────────────
router.get('/', cartController.getCart);
router.delete('/', cartController.clearCart);

// ── Items ─────────────────────────────────────────────────────────────────────
router.post('/items', cartController.addItem);
router.patch('/items/:sku', cartController.updateItem);
router.delete('/items/:sku', cartController.removeItem);

// ── Coupon ────────────────────────────────────────────────────────────────────
router.post('/coupon', cartController.applyCoupon);
router.delete('/coupon', cartController.removeCoupon);

module.exports = router;
