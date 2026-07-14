const Cart = require('../models/Cart');
const Product = require('../models/Products');
const Coupon = require('../models/Coupon');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { calculateDiscount, assertEligibility } = require('./couponController');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const generateCartCode = () => `CART-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;

/**
 * Recomputes cart.subtotal from items, coupon_discount and shipping_charges.
 * Always call this before saving after any mutation.
 */
const recomputeSubtotal = (cart) => {
  const itemsTotal = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discount = cart.coupon_discount || 0;
  const shipping = cart.shipping_charges || 0;
  cart.subtotal = parseFloat((itemsTotal - discount + shipping).toFixed(2));
};

/**
 * Fetches the current price and validates stock for a SKU.
 * Throws ApiError if product/variant not found or out of stock.
 */
const resolveVariant = async (sku, requestedQty) => {
  const product = await Product.findOne({ 'variants.sku': sku.toUpperCase(), status: 'active' });
  if (!product) throw new ApiError(404, `Product with SKU ${sku} not found`);

  const variant = product.getVariantBySku(sku);
  if (!variant || !variant.is_active) throw new ApiError(404, `Variant ${sku} is not available`);

  if (!variant.allow_backorder && variant.stock_quantity < requestedQty) {
    throw new ApiError(400, `Only ${variant.stock_quantity} unit(s) available for SKU ${sku}`);
  }

  return { price: variant.price, variant };
};

// ---------------------------------------------------------------------------
// Cart operations
// ---------------------------------------------------------------------------

/**
 * GET /api/cart
 * Returns the authenticated user's active cart (creates one if none exists).
 */
exports.getCart = catchAsync(async (req, res) => {
  let cart = await Cart.findOne({ user_id: String(req.user._id) });

  if (!cart) {
    cart = await Cart.create({
      cart_code: generateCartCode(),
      user_id: String(req.user._id),
      items: [],
      subtotal: 0,
    });
  }

  res.status(200).json({ success: true, data: { cart } });
});

/**
 * POST /api/cart/items
 * Add an item or increase its quantity.
 * Body: { product_sku, quantity }
 */
exports.addItem = catchAsync(async (req, res) => {
  const { product_sku, quantity = 1 } = req.body;

  if (!product_sku) throw new ApiError(400, 'product_sku is required');
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new ApiError(400, 'quantity must be a positive integer');
  }

  let cart = await Cart.findOne({ user_id: String(req.user._id) });
  if (!cart) {
    cart = new Cart({ cart_code: generateCartCode(), user_id: String(req.user._id), items: [] });
  }

  const existing = cart.items.find(
    (i) => i.product_sku.toUpperCase() === product_sku.toUpperCase()
  );
  const newQty = (existing?.quantity || 0) + quantity;

  const { price } = await resolveVariant(product_sku, newQty);

  if (existing) {
    existing.quantity = newQty;
    existing.price = price; // refresh price in case it changed
  } else {
    cart.items.push({ product_sku: product_sku.toUpperCase(), quantity, price });
  }

  // If a coupon was already applied, re-validate and recompute discount.
  if (cart.is_coupon_applied && cart.coupon_code) {
    try {
      const coupon = await Coupon.findOne({ coupon_code: cart.coupon_code });
      if (coupon) {
        const itemsTotal = cart.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
        cart.coupon_discount = calculateDiscount(coupon, itemsTotal);
      }
    } catch {
      // If coupon is no longer valid, silently remove it.
      cart.is_coupon_applied = false;
      cart.coupon_code = undefined;
      cart.coupon_discount = 0;
    }
  }

  recomputeSubtotal(cart);
  await cart.save();

  res.status(200).json({ success: true, message: 'Item added to cart', data: { cart } });
});

/**
 * PATCH /api/cart/items/:sku
 * Set an item's quantity to an exact value. Pass quantity: 0 to remove.
 * Body: { quantity }
 */
exports.updateItem = catchAsync(async (req, res) => {
  const sku = req.params.sku.toUpperCase();
  const { quantity } = req.body;

  if (typeof quantity !== 'number' || quantity < 0) {
    throw new ApiError(400, 'quantity must be a non-negative number');
  }

  const cart = await Cart.findOne({ user_id: String(req.user._id) });
  if (!cart) throw new ApiError(404, 'Cart not found');

  const idx = cart.items.findIndex((i) => i.product_sku === sku);
  if (idx === -1) throw new ApiError(404, `Item ${sku} not in cart`);

  if (quantity === 0) {
    cart.items.splice(idx, 1);
  } else {
    const { price } = await resolveVariant(sku, quantity);
    cart.items[idx].quantity = quantity;
    cart.items[idx].price = price;
  }

  // Revalidate coupon after quantity change.
  if (cart.is_coupon_applied && cart.coupon_code) {
    try {
      const coupon = await Coupon.findOne({ coupon_code: cart.coupon_code });
      if (coupon) {
        const itemsTotal = cart.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
        cart.coupon_discount = calculateDiscount(coupon, itemsTotal);
      }
    } catch {
      cart.is_coupon_applied = false;
      cart.coupon_code = undefined;
      cart.coupon_discount = 0;
    }
  }

  recomputeSubtotal(cart);
  await cart.save();

  res.status(200).json({ success: true, message: 'Cart updated', data: { cart } });
});

/**
 * DELETE /api/cart/items/:sku
 * Remove a specific item from the cart.
 */
exports.removeItem = catchAsync(async (req, res) => {
  const sku = req.params.sku.toUpperCase();
  const cart = await Cart.findOne({ user_id: String(req.user._id) });
  if (!cart) throw new ApiError(404, 'Cart not found');

  const idx = cart.items.findIndex((i) => i.product_sku === sku);
  if (idx === -1) throw new ApiError(404, `Item ${sku} not in cart`);

  cart.items.splice(idx, 1);

  // Recompute coupon discount on reduced basket.
  if (cart.is_coupon_applied && cart.coupon_code) {
    try {
      const coupon = await Coupon.findOne({ coupon_code: cart.coupon_code });
      if (coupon) {
        const itemsTotal = cart.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
        cart.coupon_discount = calculateDiscount(coupon, itemsTotal);
      }
    } catch {
      cart.is_coupon_applied = false;
      cart.coupon_code = undefined;
      cart.coupon_discount = 0;
    }
  }

  recomputeSubtotal(cart);
  await cart.save();

  res.status(200).json({ success: true, message: 'Item removed from cart', data: { cart } });
});

/**
 * DELETE /api/cart
 * Clears all items and resets the cart.
 */
exports.clearCart = catchAsync(async (req, res) => {
  const cart = await Cart.findOne({ user_id: String(req.user._id) });
  if (!cart) throw new ApiError(404, 'Cart not found');

  cart.items = [];
  cart.is_coupon_applied = false;
  cart.coupon_code = undefined;
  cart.coupon_discount = 0;
  cart.shipping_charges = 0;
  cart.subtotal = 0;
  await cart.save();

  res.status(200).json({ success: true, message: 'Cart cleared', data: { cart } });
});

// ---------------------------------------------------------------------------
// Coupon application
// ---------------------------------------------------------------------------

/**
 * POST /api/cart/coupon
 * Apply a coupon to the cart.
 * Body: { coupon_code }
 */
exports.applyCoupon = catchAsync(async (req, res) => {
  const { coupon_code } = req.body;
  if (!coupon_code) throw new ApiError(400, 'coupon_code is required');

  const cart = await Cart.findOne({ user_id: String(req.user._id) });
  if (!cart) throw new ApiError(404, 'Cart not found');
  if (cart.items.length === 0) throw new ApiError(400, 'Cannot apply a coupon to an empty cart');

  const coupon = await Coupon.findOne({ coupon_code: coupon_code.toUpperCase() });
  if (!coupon) throw new ApiError(404, 'Invalid coupon code');

  assertEligibility(coupon, req.user, req.user.created_at);

  // Validate product restriction if coupon is product-specific.
  if (coupon.is_selected_products_only && coupon.product_ids.length > 0) {
    const cartSkus = cart.items.map((i) => i.product_sku);
    // Find at least one eligible product in the cart.
    const products = await Product.find({ 'variants.sku': { $in: cartSkus }, status: 'active' });
    const productIds = products.map((p) => String(p._id));
    const hasEligibleProduct = coupon.product_ids.some((id) => productIds.includes(id));
    if (!hasEligibleProduct) {
      throw new ApiError(400, 'This coupon is not applicable to the products in your cart');
    }
  }

  const itemsTotal = cart.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const discount = calculateDiscount(coupon, itemsTotal);

  cart.is_coupon_applied = true;
  cart.coupon_code = coupon.coupon_code;
  cart.coupon_discount = discount;
  recomputeSubtotal(cart);
  await cart.save();

  res.status(200).json({
    success: true,
    message: 'Coupon applied successfully',
    data: {
      coupon_code: coupon.coupon_code,
      discount_amount: discount,
      subtotal: cart.subtotal,
    },
  });
});

/**
 * DELETE /api/cart/coupon
 * Remove the currently applied coupon.
 */
exports.removeCoupon = catchAsync(async (req, res) => {
  const cart = await Cart.findOne({ user_id: String(req.user._id) });
  if (!cart) throw new ApiError(404, 'Cart not found');

  cart.is_coupon_applied = false;
  cart.coupon_code = undefined;
  cart.coupon_discount = 0;
  recomputeSubtotal(cart);
  await cart.save();

  res.status(200).json({ success: true, message: 'Coupon removed', data: { subtotal: cart.subtotal } });
});
