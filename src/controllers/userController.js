const crypto = require('crypto');
const User = require('../models/User');
const Warehouse = require('../models/Warehouse');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const sendEmail = require('../utils/sendEmail');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Roles that can be created/managed through this controller (not end-customers). */
const STAFF_ROLES = ['admin', 'rider', 'marketing', 'customer_support'];

/** Safe fields to return — never expose tokens, password, refresh_tokens. */
const SAFE_SELECT =
  'first_name last_name email phone_number profile_picture user_role status ' +
  'is_email_verified is_phone_verified is_account_locked is_allowed_all_warehouse ' +
  'warehouse_id warehouse_code last_login created_at updated_at';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validates and resolves warehouse assignment from request body.
 * Returns { warehouse_id, warehouse_code, is_allowed_all_warehouse }
 *
 * Rules:
 *  - is_allowed_all_warehouse: true  → no warehouse_id required (super-admin)
 *  - warehouse_id provided           → must exist in DB
 *  - neither provided                → warehouse_id = null (unassigned)
 */
const resolveWarehouseAssignment = async (body) => {
  const { is_allowed_all_warehouse, warehouse_id } = body;

  if (is_allowed_all_warehouse === true) {
    return { is_allowed_all_warehouse: true, warehouse_id: null, warehouse_code: null };
  }

  if (warehouse_id) {
    const warehouse = await Warehouse.findById(warehouse_id);
    if (!warehouse) throw new ApiError(404, 'Warehouse not found');
    return {
      is_allowed_all_warehouse: false,
      warehouse_id:   warehouse._id,
      warehouse_code: warehouse.warehouse_code,
    };
  }

  return { is_allowed_all_warehouse: false, warehouse_id: null, warehouse_code: null };
};

/**
 * Sends a welcome email to a newly created staff member with a
 * temporary password and a prompt to change it on first login.
 */
const sendWelcomeEmail = async (user, tempPassword) => {
  try {
    await sendEmail({
      to:      user.email,
      subject: 'Welcome — your account has been created',
      html: `<p>Hi ${user.first_name},</p>
             <p>An account has been created for you on our platform with the role <strong>${user.user_role}</strong>.</p>
             <p><strong>Email:</strong> ${user.email}<br/>
                <strong>Temporary password:</strong> ${tempPassword}</p>
             <p>Please log in and change your password immediately.</p>`,
    });
  } catch (err) {
    console.error(`[User notify] Welcome email failed for ${user.email}:`, err.message);
  }
};

// ---------------------------------------------------------------------------
// GET — list users
// ---------------------------------------------------------------------------

/**
 * GET /api/users
 *
 * Lists all staff users. Regular `user` role accounts are excluded —
 * customers are managed separately.
 *
 * Query params:
 *   role          — filter by user_role
 *   status        — filter by status
 *   warehouse_id  — filter by warehouse
 *   search        — partial match on first_name, last_name, email
 *   page, limit
 */
exports.getAllUsers = catchAsync(async (req, res) => {
  const { role, status, warehouse_id, search, page = 1, limit = 20 } = req.query;

  const filter = {
    // Exclude end-customers from staff management views.
    user_role: { $in: STAFF_ROLES },
  };

  if (role)         filter.user_role    = role;
  if (status)       filter.status       = status;
  if (warehouse_id) filter.warehouse_id = warehouse_id;

  if (search) {
    const re = { $regex: search, $options: 'i' };
    filter.$or = [{ first_name: re }, { last_name: re }, { email: re }];
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [users, total] = await Promise.all([
    User.find(filter)
      .select(SAFE_SELECT)
      .populate('warehouse_id', 'name warehouse_code city')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(Number(limit)),
    User.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      users,
      pagination: {
        total,
        page:  Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    },
  });
});

/**
 * GET /api/users/admins
 *
 * Lists only admin accounts, including super-admins.
 */
exports.getAllAdmins = catchAsync(async (req, res) => {
  const { status, warehouse_id, search, page = 1, limit = 20 } = req.query;

  const filter = { user_role: 'admin' };
  if (status)       filter.status       = status;
  if (warehouse_id) filter.warehouse_id = warehouse_id;

  if (search) {
    const re = { $regex: search, $options: 'i' };
    filter.$or = [{ first_name: re }, { last_name: re }, { email: re }];
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [users, total] = await Promise.all([
    User.find(filter)
      .select(SAFE_SELECT)
      .populate('warehouse_id', 'name warehouse_code city')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(Number(limit)),
    User.countDocuments(filter),
  ]);

  res.status(200).json({ success: true, data: { users, pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) } } });
});

/** GET /api/users/:id */
exports.getUser = catchAsync(async (req, res) => {
  const user = await User.findById(req.params.id)
    .select(SAFE_SELECT)
    .populate('warehouse_id', 'name warehouse_code city');

  if (!user) throw new ApiError(404, 'User not found');

  res.status(200).json({ success: true, data: { user } });
});

// ---------------------------------------------------------------------------
// POST — create staff accounts
// ---------------------------------------------------------------------------

/**
 * POST /api/users/create-staff
 *
 * Creates any staff account: admin, rider, marketing, customer_support.
 *
 * Body: {
 *   first_name, last_name, email, phone_number?,
 *   user_role: 'admin' | 'rider' | 'marketing' | 'customer_support',
 *   warehouse_id?,          — assign to a specific warehouse
 *   is_allowed_all_warehouse? — true = super-admin (admin role only)
 * }
 *
 * A secure temporary password is auto-generated and emailed.
 * The user must change it on first login.
 */
exports.createStaffUser = catchAsync(async (req, res) => {
  const { first_name, last_name, email, phone_number, user_role } = req.body;

  if (!first_name)  throw new ApiError(400, 'first_name is required');
  if (!last_name)   throw new ApiError(400, 'last_name is required');
  if (!email)       throw new ApiError(400, 'email is required');
  if (!user_role)   throw new ApiError(400, 'user_role is required');

  if (!STAFF_ROLES.includes(user_role)) {
    throw new ApiError(400, `user_role must be one of: ${STAFF_ROLES.join(', ')}`);
  }

  // Only admin role can be granted all-warehouse access.
  if (req.body.is_allowed_all_warehouse && user_role !== 'admin') {
    throw new ApiError(
      400,
      'is_allowed_all_warehouse can only be set for admin role users'
    );
  }

  const existing = await User.findOne({ email: email.toLowerCase().trim() });
  if (existing) throw new ApiError(409, 'An account with this email already exists');

  // Resolve warehouse assignment.
  const warehouseData = await resolveWarehouseAssignment(req.body);

  // Generate a secure temporary password.
  const tempPassword = crypto.randomBytes(10).toString('base64url').slice(0, 12) + '#1';

  const user = new User({
    first_name,
    last_name,
    email,
    phone_number:      phone_number || null,
    password:          tempPassword,
    user_role,
    is_email_verified: true, // created by a trusted admin
    auth_providers:    ['local'],
    status:            'active',
    ...warehouseData,
  });

  await user.save();

  // Email the temporary password.
  await sendWelcomeEmail(user, tempPassword);

  res.status(201).json({
    success: true,
    message: `${user_role} account created. A welcome email with login credentials has been sent.`,
    data: { user: user.toSafeJSON() },
  });
});

// ---------------------------------------------------------------------------
// PATCH — update staff account
// ---------------------------------------------------------------------------

/**
 * PATCH /api/users/:id
 *
 * Admin can update any staff user's profile, role, status, and warehouse.
 *
 * Protected fields (silently ignored if sent):
 *   password, refresh_tokens, login_attempts, wallet_balance, reward_points,
 *   push_tokens, all token fields.
 *
 * Admins CANNOT demote or change another admin's role — only a super-admin
 * (is_allowed_all_warehouse: true) can reassign admin roles.
 */
exports.updateUser = catchAsync(async (req, res) => {
  const target = await User.findById(req.params.id).select(SAFE_SELECT + ' user_role');
  if (!target) throw new ApiError(404, 'User not found');

  // ── Guard: admins cannot modify other admins unless they are super-admin ─
  if (
    target.user_role === 'admin' &&
    String(target._id) !== String(req.user._id) && // allow self-edit
    !req.user.is_allowed_all_warehouse
  ) {
    throw new ApiError(403, 'Only super-admins can modify other admin accounts');
  }

  // ── Whitelist updatable fields ───────────────────────────────────────────
  const ALLOWED = [
    'first_name', 'last_name', 'phone_number', 'profile_picture',
    'user_role', 'status',
  ];
  ALLOWED.forEach((field) => {
    if (field in req.body) target[field] = req.body[field];
  });

  // ── Warehouse re-assignment ──────────────────────────────────────────────
  if ('warehouse_id' in req.body || 'is_allowed_all_warehouse' in req.body) {
    const warehouseData = await resolveWarehouseAssignment(req.body);
    Object.assign(target, warehouseData);
  }

  // Validate role change: is_allowed_all_warehouse only valid for admin.
  if (target.is_allowed_all_warehouse && target.user_role !== 'admin') {
    throw new ApiError(400, 'is_allowed_all_warehouse can only be set for admin role users');
  }

  await target.save({ validateBeforeSave: true });

  res.status(200).json({
    success: true,
    message: 'User updated successfully',
    data: { user: target.toSafeJSON() },
  });
});

// ---------------------------------------------------------------------------
// PATCH — suspend / activate account
// ---------------------------------------------------------------------------

/**
 * PATCH /api/users/:id/status
 *
 * Quickly toggle status without a full update.
 * Body: { status: 'active' | 'inactive' | 'suspended' }
 *
 * Admins cannot suspend other admins (only super-admin can).
 */
exports.updateUserStatus = catchAsync(async (req, res) => {
  const { status } = req.body;
  const VALID_STATUSES = ['active', 'inactive', 'suspended'];

  if (!VALID_STATUSES.includes(status)) {
    throw new ApiError(400, `status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  const target = await User.findById(req.params.id);
  if (!target) throw new ApiError(404, 'User not found');

  // Customer support may only lock/unlock end-customer accounts.
  if (req.user.user_role === 'customer_support' && target.user_role !== 'user') {
    throw new ApiError(403, 'Customer support can only manage customer accounts');
  }

  // Guard: prevent admins from suspending each other unless super-admin.
  if (
    target.user_role === 'admin' &&
    String(target._id) !== String(req.user._id) &&
    !req.user.is_allowed_all_warehouse
  ) {
    throw new ApiError(403, 'Only super-admins can change another admin\'s status');
  }

  target.status = status;
  // If reactivating, also clear any account lock.
  if (status === 'active') {
    target.is_account_locked  = false;
    target.login_attempts     = 0;
    target.account_locked_until = undefined;
  }

  await target.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    message: `User status updated to ${status}`,
    data: { user: target.toSafeJSON() },
  });
});

// ---------------------------------------------------------------------------
// DELETE — soft delete only (set status: 'deleted')
// Admins CANNOT hard-delete or delete other admins.
// ---------------------------------------------------------------------------

/**
 * DELETE /api/users/:id
 *
 * Soft-deletes a staff user by setting status = 'deleted'.
 * Hard delete is not supported — accounts are never physically removed.
 *
 * Rules:
 *  - Admin cannot delete another admin account.
 *  - Only super-admin can delete an admin account.
 *  - No one can delete their own account through this endpoint.
 */
exports.deleteUser = catchAsync(async (req, res) => {
  // Prevent self-deletion.
  if (String(req.params.id) === String(req.user._id)) {
    throw new ApiError(400, 'You cannot delete your own account');
  }

  const target = await User.findById(req.params.id);
  if (!target) throw new ApiError(404, 'User not found');

  // Admins cannot delete other admins — super-admin only.
  if (
    target.user_role === 'admin' &&
    !req.user.is_allowed_all_warehouse
  ) {
    throw new ApiError(
      403,
      'Admin accounts can only be deleted by a super-admin'
    );
  }

  target.status = 'deleted';
  // Revoke all active sessions.
  target.refresh_tokens = [];
  await target.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    message: 'User account has been deactivated',
  });
});

// ---------------------------------------------------------------------------
// PATCH — unlock a locked account
// ---------------------------------------------------------------------------

/**
 * PATCH /api/users/:id/unlock
 * Resets login_attempts, clears the lock.
 */
exports.unlockUser = catchAsync(async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target) throw new ApiError(404, 'User not found');

  // Customer support may only unlock end-customer accounts.
  if (req.user.user_role === 'customer_support' && target.user_role !== 'user') {
    throw new ApiError(403, 'Customer support can only manage customer accounts');
  }

  target.is_account_locked    = false;
  target.login_attempts       = 0;
  target.account_locked_until = undefined;
  await target.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    message: 'Account unlocked successfully',
    data: { user: target.toSafeJSON() },
  });
});

// ---------------------------------------------------------------------------
// GET — customers (regular users — separate from staff)
// ---------------------------------------------------------------------------

/**
 * GET /api/users/customers
 * Lists end-customer accounts (user_role = 'user').
 */
exports.getAllCustomers = catchAsync(async (req, res) => {
  const { status, search, page = 1, limit = 20 } = req.query;

  const filter = { user_role: 'user' };
  if (status) filter.status = status;

  if (search) {
    const re = { $regex: search, $options: 'i' };
    filter.$or = [{ first_name: re }, { last_name: re }, { email: re }];
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [users, total] = await Promise.all([
    User.find(filter)
      .select(SAFE_SELECT)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(Number(limit)),
    User.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      users,
      pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
    },
  });
});
