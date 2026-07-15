const Vendor = require('../models/Vendor');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

/** GET /api/vendors */
exports.getAllVendors = catchAsync(async (req, res) => {
  const { page = 1, limit = 20, status, search } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (search) {
    const re = { $regex: search, $options: 'i' };
    filter.$or = [
      { vendor_code: re },
      { full_name: re },
      { email: re },
    ];
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [vendors, total] = await Promise.all([
    Vendor.find(filter).sort({ created_at: -1 }).skip(skip).limit(Number(limit)),
    Vendor.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      vendors,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    },
  });
});

/** GET /api/vendors/:id */
exports.getVendor = catchAsync(async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) throw new ApiError(404, 'Vendor not found');
  res.status(200).json({ success: true, data: { vendor } });
});

/** POST /api/vendors */
exports.createVendor = catchAsync(async (req, res) => {
  const { vendor_code, full_name, email, phone_number, status, notes } = req.body;
  if (!vendor_code) throw new ApiError(400, 'vendor_code is required');
  if (!full_name) throw new ApiError(400, 'full_name is required');

  const code = String(vendor_code).trim().toUpperCase();
  const existing = await Vendor.findOne({ vendor_code: code });
  if (existing) throw new ApiError(409, 'A vendor with this code already exists');

  const vendor = await Vendor.create({
    vendor_code: code,
    full_name: String(full_name).trim(),
    email: email ? String(email).trim().toLowerCase() : undefined,
    phone_number: phone_number || undefined,
    status: status === 'inactive' ? 'inactive' : 'active',
    notes: notes || '',
  });

  res.status(201).json({
    success: true,
    message: 'Vendor created successfully',
    data: { vendor },
  });
});

/** PATCH /api/vendors/:id */
exports.updateVendor = catchAsync(async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) throw new ApiError(404, 'Vendor not found');

  const { vendor_code, full_name, email, phone_number, status, notes } = req.body;

  if (vendor_code !== undefined) {
    const code = String(vendor_code).trim().toUpperCase();
    const clash = await Vendor.findOne({
      vendor_code: code,
      _id: { $ne: vendor._id },
    });
    if (clash) throw new ApiError(409, 'A vendor with this code already exists');
    vendor.vendor_code = code;
  }
  if (full_name !== undefined) vendor.full_name = String(full_name).trim();
  if (email !== undefined) vendor.email = email ? String(email).trim().toLowerCase() : '';
  if (phone_number !== undefined) vendor.phone_number = phone_number;
  if (status !== undefined) {
    if (!['active', 'inactive'].includes(status)) {
      throw new ApiError(400, 'status must be active or inactive');
    }
    vendor.status = status;
  }
  if (notes !== undefined) vendor.notes = notes;

  await vendor.save();

  res.status(200).json({
    success: true,
    message: 'Vendor updated successfully',
    data: { vendor },
  });
});

/** DELETE /api/vendors/:id */
exports.deleteVendor = catchAsync(async (req, res) => {
  const vendor = await Vendor.findByIdAndDelete(req.params.id);
  if (!vendor) throw new ApiError(404, 'Vendor not found');
  res.status(200).json({ success: true, message: 'Vendor deleted successfully' });
});
