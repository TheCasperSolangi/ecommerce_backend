const express = require('express');
const warehouseController = require('../controllers/warehouseController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

// All warehouse management routes require a logged-in admin.
// Super-admin enforcement (is_allowed_all_warehouse) for sensitive ops
// is handled inside the controller where needed.
router.use(authenticate, authorize('admin'));

// ── Warehouse CRUD ────────────────────────────────────────────────────────────
router.get('/', warehouseController.getAllWarehouses);
router.get('/:id', warehouseController.getWarehouse);
router.post('/', warehouseController.createWarehouse);
router.patch('/:id', warehouseController.updateWarehouse);
router.delete('/:id', warehouseController.deleteWarehouse);

// ── User assignment ───────────────────────────────────────────────────────────
router.get('/:id/users', warehouseController.getWarehouseUsers);
router.patch('/:warehouseId/users/:userId/assign', warehouseController.assignUserToWarehouse);
router.patch('/users/:userId/unassign', warehouseController.unassignUserFromWarehouse);
router.patch('/users/:userId/super-admin', warehouseController.toggleSuperAdmin);

module.exports = router;
