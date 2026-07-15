const Coupon = require('../models/Coupon');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Calculates the discount amount for a given cart subtotal.
 *
 * @param {object} coupon  - Mongoose coupon document
 * @param {number} subtotal - Cart subtotal before discount
 * @returns {number} Final discount amount to deduct
 */
const calculateDiscount = (coupon, subtotal) => {
  if (coupon.discount_type === 'FLAT_FIAT') {
    // Flat fixed amount — never exceed the subtotal.
    return Math.min(coupon.value, subtotal);
  }

  // CAPED_PERCENTAGE — percentage discount with an optional ceiling.
  const raw = (coupon.value / 100) * subtotal;
  const capped = coupon.capped_at ? Math.min(raw, coupon.capped_at) : raw;
  return Math.min(parseFloat(capped.toFixed(2)), subtotal);
};

/**
 * Validates coupon eligibility for the requesting user.
 * Throws ApiError on failure so the caller can surface or swallow it.
 *
 * @param {object} coupon  - Mongoose coupon document
 * @param {object} user    - req.user
 * @param {Date}   userCreatedAt - user.created_at for new-customer check
 */
const assertEligibility = (coupon, user, userCreatedAt) => {
  const now = new Date();

  if (coupon.expires_at && coupon.expires_at < now) {
    throw new ApiError(400, 'This coupon has expired');
  }
  if (coupon.is_active === false) {
    throw new ApiError(400, 'This coupon is no longer active');
  }
  if (
    coupon.usage_limit != null &&
    Number(coupon.usage_count || 0) >= Number(coupon.usage_limit)
  ) {
    throw new ApiError(400, 'This coupon has reached its usage limit');
  }

  switch (coupon.eligibility_type) {
    case 'NEW_CUSTOMERS':
      if (coupon.new_customer_date_till && userCreatedAt < coupon.new_customer_date_till) {
        throw new ApiError(400, 'This coupon is only valid for new customers');
      }
      break;

    case 'SPECIFIC_CUSTOMERS':
      if (!coupon.eligible_customers.map(String).includes(String(user._id))) {
        throw new ApiError(400, 'You are not eligible for this coupon');
      }
      break;

    case 'EVERYONE':
      break; // always eligible

    case 'SELECTED_CARD_TYPES':
      // Card-type check happens at payment time; we allow it through here.
      break;

    default:
      throw new ApiError(400, 'Unknown coupon eligibility type');
  }
};

// Export helpers so cartController can reuse them.
exports.calculateDiscount = calculateDiscount;
exports.assertEligibility = assertEligibility;

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/** POST /api/coupons/validate
 *  Body: { coupon_code, subtotal }
 *  Lets the frontend preview the discount before checkout. */
exports.validateCoupon = catchAsync(async (req, res) => {
  const { coupon_code, subtotal } = req.body;
  if (!coupon_code) throw new ApiError(400, 'coupon_code is required');
  if (typeof subtotal !== 'number' || subtotal <= 0) {
    throw new ApiError(400, 'subtotal must be a positive number');
  }

  const coupon = await Coupon.findOne({ coupon_code: coupon_code.toUpperCase() });
  if (!coupon) throw new ApiError(404, 'Invalid coupon code');

  assertEligibility(coupon, req.user, req.user.created_at);

  const discount = calculateDiscount(coupon, subtotal);

  res.status(200).json({
    success: true,
    data: {
      coupon_code: coupon.coupon_code,
      discount_type: coupon.discount_type,
      discount_amount: discount,
      final_total: parseFloat((subtotal - discount).toFixed(2)),
    },
  });
});

// ---------------------------------------------------------------------------
// Admin — CRUD
// ---------------------------------------------------------------------------

/** GET /api/coupons */
exports.getAllCoupons = catchAsync(async (req, res) => {
  const { page = 1, limit = 20, is_active, search } = req.query;
  const filter = {};
  if (is_active !== undefined) filter.is_active = is_active === 'true';
  if (search) filter.coupon_code = { $regex: search.toUpperCase(), $options: 'i' };

  const skip = (Number(page) - 1) * Number(limit);
  const [coupons, total] = await Promise.all([
    Coupon.find(filter).sort({ created_at: -1 }).skip(skip).limit(Number(limit)),
    Coupon.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      coupons,
      pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
    },
  });
});

/** GET /api/coupons/:id */
exports.getCoupon = catchAsync(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw new ApiError(404, 'Coupon not found');
  res.status(200).json({ success: true, data: { coupon } });
});

/** POST /api/coupons */
exports.createCoupon = catchAsync(async (req, res) => {
  const coupon = await Coupon.create({
    ...req.body,
    coupon_code: req.body.coupon_code?.toUpperCase(),
    usage_count: 0,
  });
  res.status(201).json({ success: true, message: 'Coupon created successfully', data: { coupon } });
});

/** PATCH /api/coupons/:id */
exports.updateCoupon = catchAsync(async (req, res) => {
  // Prevent manual tampering of usage count.
  const { usage_count, ...data } = req.body;
  if (data.coupon_code) data.coupon_code = data.coupon_code.toUpperCase();

  const coupon = await Coupon.findByIdAndUpdate(req.params.id, data, {
    new: true,
    runValidators: true,
  });
  if (!coupon) throw new ApiError(404, 'Coupon not found');

  res.status(200).json({ success: true, message: 'Coupon updated successfully', data: { coupon } });
});

/** DELETE /api/coupons/:id */
exports.deleteCoupon = catchAsync(async (req, res) => {
  const coupon = await Coupon.findByIdAndDelete(req.params.id);
  if (!coupon) throw new ApiError(404, 'Coupon not found');
  res.status(200).json({ success: true, message: 'Coupon deleted successfully' });
});
