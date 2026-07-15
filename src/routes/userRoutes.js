const express = require('express');
const userController = require('../controllers/userController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

router.use(authenticate);

// Customer list + lock/unlock — admin and customer support
router.get(
  '/customers',
  authorize('admin', 'customer_support'),
  userController.getAllCustomers
);
router.patch(
  '/:id/status',
  authorize('admin', 'customer_support'),
  userController.updateUserStatus
);
router.patch(
  '/:id/unlock',
  authorize('admin', 'customer_support'),
  userController.unlockUser
);

// Remaining user-management routes — admin only
router.use(authorize('admin'));

// ── Listing ───────────────────────────────────────────────────────────────────
// GET /api/users              — all staff (admins, riders, marketing, support)
// GET /api/users/admins       — admin accounts only
// GET /api/users/:id          — single user detail
//
// Note: specific named routes must come BEFORE /:id to avoid param collision.
router.get('/admins', userController.getAllAdmins);
router.get('/', userController.getAllUsers);
router.get('/:id', userController.getUser);

// ── Create ────────────────────────────────────────────────────────────────────
// POST /api/users/create-staff
router.post('/create-staff', userController.createStaffUser);

// ── Update ────────────────────────────────────────────────────────────────────
router.patch('/:id', userController.updateUser);

// ── Soft delete ───────────────────────────────────────────────────────────────
router.delete('/:id', userController.deleteUser);

module.exports = router;
