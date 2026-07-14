const express = require('express');
const couponController = require('../controllers/couponController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

// ── Authenticated users — validate a coupon before checkout ──────────────────
router.post('/validate', authenticate, couponController.validateCoupon);

// ── Admin only — CRUD ─────────────────────────────────────────────────────────
router.use(authenticate, authorize('admin'));

router.get('/', couponController.getAllCoupons);
router.get('/:id', couponController.getCoupon);
router.post('/', couponController.createCoupon);
router.patch('/:id', couponController.updateCoupon);
router.delete('/:id', couponController.deleteCoupon);

module.exports = router;
