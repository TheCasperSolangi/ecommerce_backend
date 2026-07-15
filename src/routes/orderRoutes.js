const express = require('express');
const orderController = require('../controllers/orderController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const warehouseScope = require('../middleware/warehouseScope');

const router = express.Router();

// ── Public — order tracking (no auth required) ────────────────────────────────
// Must be registered BEFORE router.use(authenticate) so it is reachable
// without a token.
router.get('/track/:orderCode', orderController.trackOrder);

// ── All routes below this line require authentication ─────────────────────────
router.use(authenticate);

// ── Admin routes MUST be registered before /:id so "admin" is not treated as an id ─
const adminWarehouse = [authorize('admin'), warehouseScope];

router.get('/admin/orders', adminWarehouse, orderController.adminGetAllOrders);
router.get('/admin/orders/:id', adminWarehouse, orderController.adminGetOrder);
router.patch('/admin/orders/:id/status', adminWarehouse, orderController.adminUpdateOrderStatus);
router.patch('/admin/orders/:id/assign-rider', adminWarehouse, orderController.adminAssignRider);
router.post('/admin/orders/:id/refund', adminWarehouse, orderController.adminRefund);
router.get('/admin/list',   adminWarehouse, orderController.getOrdersList);
router.get('/admin/report', adminWarehouse, orderController.getOrdersReport);

// ── Customer routes ───────────────────────────────────────────────────────────
router.post('/', orderController.placeOrder);
router.get('/', orderController.getMyOrders);
router.get('/:id', orderController.getOrder);
router.post('/:id/cancel', orderController.cancelOrder);

// ── Rider routes ──────────────────────────────────────────────────────────────
router.patch('/:id/rider-update', authorize('rider'), orderController.riderUpdateOrder);

module.exports = router;
