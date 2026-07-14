const express = require('express');
const userController = require('../controllers/userController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

// All user-management routes require a logged-in admin.
router.use(authenticate, authorize('admin'));

// ── Listing ───────────────────────────────────────────────────────────────────
// GET /api/users              — all staff (admins, riders, marketing, support)
// GET /api/users/admins       — admin accounts only
// GET /api/users/customers    — end-customers only
// GET /api/users/:id          — single user detail
//
// Note: specific named routes must come BEFORE /:id to avoid param collision.
router.get('/admins',    userController.getAllAdmins);
router.get('/customers', userController.getAllCustomers);
router.get('/',          userController.getAllUsers);
router.get('/:id',       userController.getUser);

// ── Create ────────────────────────────────────────────────────────────────────
// POST /api/users/create-staff
// Creates admin, rider, marketing, or customer_support accounts.
// Warehouse assignment (specific or all) set via body.
router.post('/create-staff', userController.createStaffUser);

// ── Update ────────────────────────────────────────────────────────────────────
// PATCH /api/users/:id               — full profile/role/warehouse update
// PATCH /api/users/:id/status        — quick status toggle
// PATCH /api/users/:id/unlock        — clear account lock
router.patch('/:id/status', userController.updateUserStatus);
router.patch('/:id/unlock', userController.unlockUser);
router.patch('/:id',        userController.updateUser);

// ── Soft delete ───────────────────────────────────────────────────────────────
// DELETE /api/users/:id
// Sets status = 'deleted', revokes sessions.
// Admins cannot delete other admins (only super-admin can).
router.delete('/:id', userController.deleteUser);

module.exports = router;
