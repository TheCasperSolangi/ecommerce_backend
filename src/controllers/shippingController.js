const Shipping = require('../models/shipping');
const Cart = require('../models/Cart');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Finds the shipping charge for a given city/state within a shipping option.
 * Falls back to state-level pricing, then a default (first) entry, then 0.
 */
const resolvePrice = (shippingOption, city, state) => {
  if (!shippingOption.price || shippingOption.price.length === 0) return 0;
  if (shippingOption.is_free_shipping) return 0;

  const normalise = (s) => (s || '').trim().toLowerCase();

  // Exact city + state match first
  let entry = shippingOption.price.find(
    (p) => normalise(p.city) === normalise(city) && normalise(p.state) === normalise(state)
  );
  // Fall back to state-only match
  if (!entry) {
    entry = shippingOption.price.find(
      (p) => (!p.city || normalise(p.city) === '') && normalise(p.state) === normalise(state)
    );
  }
  // Fall back to first entry (default)
  if (!entry) entry = shippingOption.price[0];

  return parseFloat(entry.price) || 0;
};

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/**
 * GET /api/shipping
 * Returns available shipping options.
 * Query params: city, state — used to pre-populate the price per option.
 */
exports.getShippingOptions = catchAsync(async (req, res) => {
  const { city, state } = req.query;

  const options = await Shipping.find().select('-__v');

  const result = options.map((opt) => {
    const charge = city && state ? resolvePrice(opt, city, state) : null;
    return {
      _id: opt._id,
      shipping_type: opt.shipping_type,
      is_free_shipping: opt.is_free_shipping,
      instant_delivery_estimated_time: opt.instant_delivery_estimated_time,
      express_delivery_days: opt.express_delivery_days,
      standard_delivery_time: opt.standard_delivery_time,
      city_to_city_free_shipping: opt.city_to_city_free_shipping,
      charge: charge !== null ? charge : 'varies by location',
    };
  });

  res.status(200).json({ success: true, data: { shipping_options: result } });
});

/**
 * POST /api/shipping/apply
 * Applies a chosen shipping option to the user's active cart.
 * Body: { cart_code, shipping_id, city, state }
 */
exports.applyShippingToCart = catchAsync(async (req, res) => {
  const { cart_code, shipping_id, city, state } = req.body;

  if (!cart_code) throw new ApiError(400, 'cart_code is required');
  if (!shipping_id) throw new ApiError(400, 'shipping_id is required');
  if (!city || !state) throw new ApiError(400, 'city and state are required to calculate shipping charge');

  const cart = await Cart.findOne({ cart_code, user_id: String(req.user._id) });
  if (!cart) throw new ApiError(404, 'Cart not found');

  const shippingOption = await Shipping.findById(shipping_id);
  if (!shippingOption) throw new ApiError(404, 'Shipping option not found');

  const charge = resolvePrice(shippingOption, city, state);

  cart.shipping_charges = charge;
  cart.shipping_id = shipping_id;       // store reference so order can snapshot it
  cart.shipping_type = shippingOption.shipping_type;

  // Recalculate subtotal: items total - coupon discount + shipping
  const itemsTotal = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const couponDiscount = cart.coupon_discount || 0;
  cart.subtotal = parseFloat((itemsTotal - couponDiscount + charge).toFixed(2));

  await cart.save();

  res.status(200).json({
    success: true,
    message: 'Shipping applied to cart',
    data: {
      shipping_type: shippingOption.shipping_type,
      shipping_charges: charge,
      subtotal: cart.subtotal,
    },
  });
});

// ---------------------------------------------------------------------------
// Admin — manage shipping options
// ---------------------------------------------------------------------------

/** POST /api/shipping */
exports.createShippingOption = catchAsync(async (req, res) => {
  const option = await Shipping.create(req.body);
  res.status(201).json({ success: true, message: 'Shipping option created', data: { option } });
});

/** PATCH /api/shipping/:id */
exports.updateShippingOption = catchAsync(async (req, res) => {
  const option = await Shipping.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!option) throw new ApiError(404, 'Shipping option not found');
  res.status(200).json({ success: true, message: 'Shipping option updated', data: { option } });
});

/** DELETE /api/shipping/:id */
exports.deleteShippingOption = catchAsync(async (req, res) => {
  const option = await Shipping.findByIdAndDelete(req.params.id);
  if (!option) throw new ApiError(404, 'Shipping option not found');
  res.status(200).json({ success: true, message: 'Shipping option deleted' });
});
