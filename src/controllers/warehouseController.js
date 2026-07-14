const Warehouse = require('../models/Warehouse');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

// ---------------------------------------------------------------------------
// Warehouse CRUD  (super-admin only)
// ---------------------------------------------------------------------------

/** GET /api/warehouses */
exports.getAllWarehouses = catchAsync(async (req, res) => {
  const { page = 1, limit = 20, search } = req.query;
  const filter = {};
  if (search) {
    const re = { $regex: search, $options: 'i' };
    filter.$or = [{ name: re }, { city: re }, { state: re }, { warehouse_code: re }];
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [warehouses, total] = await Promise.all([
    Warehouse.find(filter).sort({ name: 1 }).skip(skip).limit(Number(limit)).select('-__v'),
    Warehouse.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      warehouses,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    },
  });
});

/** GET /api/warehouses/:id */
exports.getWarehouse = catchAsync(async (req, res) => {
  const warehouse = await Warehouse.findById(req.params.id).select('-__v');
  if (!warehouse) throw new ApiError(404, 'Warehouse not found');
  res.status(200).json({ success: true, data: { warehouse } });
});

/** POST /api/warehouses */
exports.createWarehouse = catchAsync(async (req, res) => {
  const { warehouse_code, name, city, state, country } = req.body;
  if (!warehouse_code || !name || !city || !state || !country) {
    throw new ApiError(400, 'warehouse_code, name, city, state and country are all required');
  }

  const existing = await Warehouse.findOne({ warehouse_code: warehouse_code.toUpperCase() });
  if (existing) throw new ApiError(409, 'A warehouse with this code already exists');

  const warehouse = await Warehouse.create({
    warehouse_code: warehouse_code.toUpperCase(),
    name,
    city,
    state,
    country,
  });

  res.status(201).json({
    success: true,
    message: 'Warehouse created successfully',
    data: { warehouse },
  });
});

/** PATCH /api/warehouses/:id */
exports.updateWarehouse = catchAsync(async (req, res) => {
  // Prevent changing the unique code after creation.
  const { warehouse_code, ...data } = req.body;

  const warehouse = await Warehouse.findByIdAndUpdate(req.params.id, data, {
    new: true,
    runValidators: true,
  });
  if (!warehouse) throw new ApiError(404, 'Warehouse not found');

  res.status(200).json({
    success: true,
    message: 'Warehouse updated successfully',
    data: { warehouse },
  });
});

/** DELETE /api/warehouses/:id */
exports.deleteWarehouse = catchAsync(async (req, res) => {
  const warehouse = await Warehouse.findById(req.params.id);
  if (!warehouse) throw new ApiError(404, 'Warehouse not found');

  // Safety check — refuse if any users are still assigned to this warehouse.
  const assignedUsers = await User.countDocuments({ warehouse_id: warehouse._id });
  if (assignedUsers > 0) {
    throw new ApiError(
      400,
      `Cannot delete warehouse — ${assignedUsers} user(s) are still assigned to it. Reassign them first.`
    );
  }

  await warehouse.deleteOne();
  res.status(200).json({ success: true, message: 'Warehouse deleted successfully' });
});

// ---------------------------------------------------------------------------
// User ↔ Warehouse assignment  (super-admin only)
// ---------------------------------------------------------------------------

/**
 * GET /api/warehouses/:id/users
 * Lists all users assigned to this warehouse.
 */
exports.getWarehouseUsers = catchAsync(async (req, res) => {
  const warehouse = await Warehouse.findById(req.params.id);
  if (!warehouse) throw new ApiError(404, 'Warehouse not found');

  const users = await User.find({ warehouse_id: warehouse._id })
    .select('first_name last_name email user_role phone_number status warehouse_id is_allowed_all_warehouse');

  res.status(200).json({ success: true, data: { users } });
});

/**
 * PATCH /api/warehouses/:warehouseId/users/:userId/assign
 * Assigns a user to this warehouse.
 */
exports.assignUserToWarehouse = catchAsync(async (req, res) => {
  const { warehouseId, userId } = req.params;

  const [warehouse, user] = await Promise.all([
    Warehouse.findById(warehouseId),
    User.findById(userId),
  ]);

  if (!warehouse) throw new ApiError(404, 'Warehouse not found');
  if (!user) throw new ApiError(404, 'User not found');

  // Super-admins should not be locked to a single warehouse.
  if (user.is_allowed_all_warehouse) {
    throw new ApiError(400, 'Super-admin users cannot be scoped to a single warehouse');
  }

  user.warehouse_id   = warehouse._id;
  user.warehouse_code = warehouse.warehouse_code;
  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    message: `User assigned to warehouse ${warehouse.name}`,
    data: { user: user.toSafeJSON() },
  });
});

/**
 * PATCH /api/warehouses/users/:userId/unassign
 * Removes a user's warehouse assignment.
 */
exports.unassignUserFromWarehouse = catchAsync(async (req, res) => {
  const user = await User.findById(req.params.userId);
  if (!user) throw new ApiError(404, 'User not found');

  user.warehouse_id   = null;
  user.warehouse_code = null;
  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    message: 'User unassigned from warehouse',
    data: { user: user.toSafeJSON() },
  });
});

/**
 * PATCH /api/warehouses/users/:userId/super-admin
 * Toggles the is_allowed_all_warehouse flag on a user.
 * Body: { is_allowed_all_warehouse: true | false }
 */
exports.toggleSuperAdmin = catchAsync(async (req, res) => {
  const { is_allowed_all_warehouse } = req.body;
  if (typeof is_allowed_all_warehouse !== 'boolean') {
    throw new ApiError(400, 'is_allowed_all_warehouse must be a boolean');
  }

  const user = await User.findById(req.params.userId);
  if (!user) throw new ApiError(404, 'User not found');

  if (user.user_role !== 'admin') {
    throw new ApiError(400, 'Only admin users can be granted super-admin warehouse access');
  }

  user.is_allowed_all_warehouse = is_allowed_all_warehouse;
  // Super-admins are not locked to any single warehouse.
  if (is_allowed_all_warehouse) {
    user.warehouse_id   = null;
    user.warehouse_code = null;
  }
  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    message: `Super-admin access ${is_allowed_all_warehouse ? 'granted' : 'revoked'}`,
    data: { user: user.toSafeJSON() },
  });
});
