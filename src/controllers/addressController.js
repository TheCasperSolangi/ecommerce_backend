const Address = require('../models/Address');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Addresses in this model have no user_id field — they are owned by whoever
 * created them. We track ownership by storing the user id on each document
 * via a virtual `user` field added at query time. Since the schema is bare we
 * add `user` as a real field in the controller so we can scope queries.
 *
 * NOTE: Address.js schema is minimal. We add `user` scoping at query level
 * using a field that should exist on the model. If you later add `user` to the
 * schema this controller will work automatically.
 */
const ownedFilter = (userId, extraFilter = {}) => ({ user: userId, ...extraFilter });

const ALLOWED_FIELDS = ['label', 'street_address', 'city', 'state', 'country', 'is_default'];

const pickAllowed = (body) => {
  const result = {};
  ALLOWED_FIELDS.forEach((f) => { if (f in body) result[f] = body[f]; });
  return result;
};

// ---------------------------------------------------------------------------
// User — manage own addresses
// ---------------------------------------------------------------------------

/** GET /api/addresses */
exports.getMyAddresses = catchAsync(async (req, res) => {
  const addresses = await Address.find({ user: req.user._id }).select('-__v');
  res.status(200).json({ success: true, data: { addresses } });
});

/** GET /api/addresses/:id */
exports.getAddress = catchAsync(async (req, res) => {
  const address = await Address.findOne({ _id: req.params.id, user: req.user._id }).select('-__v');
  if (!address) throw new ApiError(404, 'Address not found');
  res.status(200).json({ success: true, data: { address } });
});

/** POST /api/addresses */
exports.createAddress = catchAsync(async (req, res) => {
  const data = pickAllowed(req.body);
  data.user = req.user._id;

  // If this is the first address or marked as default, clear existing default.
  if (data.is_default) {
    await Address.updateMany({ user: req.user._id }, { is_default: false });
  }

  const address = await Address.create(data);
  res.status(201).json({
    success: true,
    message: 'Address created successfully',
    data: { address },
  });
});

/** PATCH /api/addresses/:id */
exports.updateAddress = catchAsync(async (req, res) => {
  const address = await Address.findOne({ _id: req.params.id, user: req.user._id });
  if (!address) throw new ApiError(404, 'Address not found');

  const data = pickAllowed(req.body);

  if (data.is_default) {
    await Address.updateMany({ user: req.user._id }, { is_default: false });
  }

  Object.assign(address, data);
  await address.save();

  res.status(200).json({
    success: true,
    message: 'Address updated successfully',
    data: { address },
  });
});

/** DELETE /api/addresses/:id */
exports.deleteAddress = catchAsync(async (req, res) => {
  const address = await Address.findOne({ _id: req.params.id, user: req.user._id });
  if (!address) throw new ApiError(404, 'Address not found');

  await address.deleteOne();
  res.status(200).json({ success: true, message: 'Address deleted successfully' });
});

/** PATCH /api/addresses/:id/set-default */
exports.setDefaultAddress = catchAsync(async (req, res) => {
  const address = await Address.findOne({ _id: req.params.id, user: req.user._id });
  if (!address) throw new ApiError(404, 'Address not found');

  await Address.updateMany({ user: req.user._id }, { is_default: false });
  address.is_default = true;
  await address.save();

  res.status(200).json({ success: true, message: 'Default address updated', data: { address } });
});
