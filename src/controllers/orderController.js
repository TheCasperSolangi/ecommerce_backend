const mongoose = require('mongoose');
const crypto = require('crypto');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const User = require('../models/User');
const Product = require('../models/Product');
const Coupon = require('../models/Coupon');
const PlatformSettings = require('../models/platformSettings');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const sendEmail = require('../utils/sendEmail');
const { sendPushToMany } = require('../utils/pushNotification');
const generateInvoicePdf = require('../utils/generateInvoicePdf');
const { createOrderTransaction } = require('./transactionController');

// ---------------------------------------------------------------------------
// Notification helper
// ---------------------------------------------------------------------------

/**
 * Human-readable label + message for each order event.
 * Returns { subject, emailHtml, pushTitle, pushBody }
 */
const buildNotificationContent = (order, event) => {
  const name  = order.user_details?.first_name || 'Customer';
  const code  = order.order_code;
  const total = order.cart_details?.subtotal ?? '';

  const map = {
    ORDER_PLACED: {
      subject:   `Order Confirmed — ${code}`,
      emailHtml: `<p>Hi ${name},</p><p>Your order <strong>${code}</strong> has been placed successfully. We'll notify you as it progresses.</p><p>Total: <strong>${total}</strong></p>`,
      pushTitle: 'Order Placed ✅',
      pushBody:  `Your order ${code} has been placed. Total: ${total}`,
    },
    CONFIRMED: {
      subject:   `Order Confirmed — ${code}`,
      emailHtml: `<p>Hi ${name},</p><p>Great news! Your order <strong>${code}</strong> has been confirmed and is being prepared.</p>`,
      pushTitle: 'Order Confirmed ✅',
      pushBody:  `Order ${code} confirmed — we're getting it ready.`,
    },
    PENDING_PAYMENT: {
      subject:   `Payment Pending — ${code}`,
      emailHtml: `<p>Hi ${name},</p><p>Your order <strong>${code}</strong> is awaiting payment confirmation. Please complete your payment to proceed.</p>`,
      pushTitle: 'Payment Pending ⏳',
      pushBody:  `Order ${code} is waiting for payment confirmation.`,
    },
    PROCESSING: {
      subject:   `Order Processing — ${code}`,
      emailHtml: `<p>Hi ${name},</p><p>Your order <strong>${code}</strong> is now being processed and packed.</p>`,
      pushTitle: 'Order Processing 📦',
      pushBody:  `Order ${code} is being packed and prepared for dispatch.`,
    },
    OUT_FOR_DELIVERY: {
      subject:   `Out for Delivery — ${code}`,
      emailHtml: `<p>Hi ${name},</p><p>Your order <strong>${code}</strong> is on its way! Expect delivery soon.</p>`,
      pushTitle: 'Out for Delivery 🚚',
      pushBody:  `Order ${code} is on its way to you!`,
    },
    DELIVERED: {
      subject:   `Order Delivered — ${code}`,
      emailHtml: `<p>Hi ${name},</p><p>Your order <strong>${code}</strong> has been delivered. Enjoy your purchase!</p><p>If you have any issues, please contact our support team.</p>`,
      pushTitle: 'Order Delivered 🎉',
      pushBody:  `Order ${code} has been delivered. Enjoy!`,
    },
    CANCELLED: {
      subject:   `Order Cancelled — ${code}`,
      emailHtml: `<p>Hi ${name},</p><p>Your order <strong>${code}</strong> has been cancelled.</p>${order.cancellation_reason ? `<p>Reason: ${order.cancellation_reason}</p>` : ''}`,
      pushTitle: 'Order Cancelled ❌',
      pushBody:  `Order ${code} has been cancelled.`,
    },
    REFUNDED: {
      subject:   `Refund Processed — ${code}`,
      emailHtml: `<p>Hi ${name},</p><p>Your refund of <strong>${order.refund_amount ?? total}</strong> for order <strong>${code}</strong> has been credited to your wallet.</p>`,
      pushTitle: 'Refund Credited 💰',
      pushBody:  `Refund for order ${code} has been added to your wallet.`,
    },
    FAILED_DELIVERY: {
      subject:   `Delivery Failed — ${code}`,
      emailHtml: `<p>Hi ${name},</p><p>Unfortunately your order <strong>${code}</strong> could not be delivered.</p>${order.delivery_failure ? `<p>Reason: ${order.delivery_failure}</p>` : ''}<p>Our team will contact you to arrange a re-attempt.</p>`,
      pushTitle: 'Delivery Failed 😟',
      pushBody:  `We couldn't deliver order ${code}. We'll arrange a re-attempt.`,
    },
    RE_ATTEMPT_DELIVERY: {
      subject:   `Re-attempt Scheduled — ${code}`,
      emailHtml: `<p>Hi ${name},</p><p>A delivery re-attempt has been scheduled for your order <strong>${code}</strong>. Please ensure someone is available to receive it.</p>`,
      pushTitle: 'Delivery Re-attempt Scheduled 🔄',
      pushBody:  `A re-delivery has been scheduled for order ${code}.`,
    },
    RIDER_ASSIGNED: {
      subject:   `Rider Assigned — ${code}`,
      emailHtml: `<p>Hi ${name},</p><p>A rider has been assigned to your order <strong>${code}</strong> and will be picking it up shortly.</p>`,
      pushTitle: 'Rider Assigned 🛵',
      pushBody:  `A rider has been assigned to deliver order ${code}.`,
    },
  };

  return map[event] || null;
};

/**
 * Fires email + push notifications to the order's customer.
 * Both channels are best-effort — failures are logged but never throw,
 * so a notification error never rolls back a successful order update.
 *
 * @param {object} order  - Saved Mongoose Order document
 * @param {string} event  - Key from buildNotificationContent map
 */
const notifyUser = async (order, event) => {
  const content = buildNotificationContent(order, event);
  if (!content) return;

  // Fetch the customer to get their email + push tokens.
  const user = await User.findById(order.user_id).select('email push_tokens');
  if (!user) return;

  // ── Email ────────────────────────────────────────────────────────────────
  try {
    await sendEmail({
      to: user.email,
      subject: content.subject,
      html: content.emailHtml,
    });
  } catch (err) {
    console.error(`[Order notify] Email failed for ${order.order_code}:`, err.message);
  }

  // ── Push notifications ───────────────────────────────────────────────────
  const tokens = (user.push_tokens || []).map((t) => t.token).filter(Boolean);
  if (tokens.length > 0) {
    try {
      await sendPushToMany(tokens, content.pushTitle, content.pushBody, {
        order_code: order.order_code,
        order_id:   String(order._id),
        event,
      });
    } catch (err) {
      console.error(`[Order notify] Push failed for ${order.order_code}:`, err.message);
    }
  }
};

// ---------------------------------------------------------------------------
// Invoice email helper
// ---------------------------------------------------------------------------

/**
 * Generates the invoice PDF and attaches it to the order-confirmation email.
 * Fire-and-forget — never throws so a PDF failure doesn't roll back an order.
 *
 * @param {object} order - Saved Mongoose Order document
 */
const sendInvoiceEmail = async (order) => {
  try {
    const [settings, user] = await Promise.all([
      PlatformSettings.findOne(),
      User.findById(order.user_id).select('email first_name'),
    ]);

    if (!user) return;

    const pdfBuffer = await generateInvoicePdf(order.toObject(), settings?.toObject());

    await sendEmail({
      to:      user.email,
      subject: `Your Invoice — ${order.order_code}`,
      html: `<p>Hi ${user.first_name},</p>
             <p>Thank you for your order! Please find your invoice attached.</p>
             <p>Order: <strong>${order.order_code}</strong></p>
             <p>Total: <strong>$${(order.cart_details?.subtotal || 0).toFixed(2)}</strong></p>
             <p>Thank you for choosing us!</p>`,
      attachments: [
        {
          filename:    `invoice-${order.order_code}.pdf`,
          content:     pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    });
  } catch (err) {
    console.error(`[Invoice email] Failed for ${order.order_code}:`, err.message);
  }
};

// Export so paymentController can call it after payment confirmation.
exports.sendInvoiceEmail = sendInvoiceEmail;

// ---------------------------------------------------------------------------
// Constants — status machine
// ---------------------------------------------------------------------------

/**
 * Statuses from which a CUSTOMER is allowed to cancel.
 * Once an order is PROCESSING or beyond, customers cannot cancel.
 */
const CUSTOMER_CANCELLABLE_STATUSES = ['PENDING', 'CONFIRMED', 'PENDING_PAYMENT'];

/**
 * Statuses from which an ADMIN can cancel (all except terminal states).
 */
const ADMIN_NON_CANCELLABLE_STATUSES = ['DELIVERED', 'REFUNDED', 'CANCELLED'];

/**
 * Statuses that are considered "terminal" — no further transitions allowed.
 * NOTE: DELIVERED is intentionally excluded so admin can issue a refund from it.
 */
const TERMINAL_STATUSES = ['REFUNDED', 'CANCELLED'];

/**
 * Valid forward status transitions (admin-driven).
 * Rider transitions are handled separately.
 */
const ADMIN_STATUS_TRANSITIONS = {
  PENDING:             ['CONFIRMED', 'PENDING_PAYMENT', 'CANCELLED'],
  CONFIRMED:           ['PROCESSING', 'CANCELLED'],
  PENDING_PAYMENT:     ['CONFIRMED', 'CANCELLED'],
  PROCESSING:          ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY:    ['DELIVERED', 'FAILED_DELIVERY'],
  FAILED_DELIVERY:     ['RE_ATTEMPT_DELIVERY', 'CANCELLED'],
  RE_ATTEMPT_DELIVERY: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  // DELIVERED is a valid source only for refund — handled in adminRefund, not here.
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const generateOrderCode = () =>
  `ORD-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

/**
 * Processes a refund by crediting the user's wallet_balance.
 * All refunds go to wallet regardless of original payment method,
 * EXCEPT CASH_ON_DELIVERY orders that were never delivered.
 *
 * @param {object} order - Mongoose Order document
 * @param {string} reason - Why the refund is being issued
 */
const processRefund = async (order, reason) => {
  // COD orders can only be refunded if they were actually delivered.
  if (
    order.payment_method === 'CASH_ON_DELIVERY' &&
    order.status !== 'DELIVERED'
  ) {
    // No money was collected — just cancel, no wallet credit.
    return false;
  }

  const refundAmount = order.cart_details?.subtotal || 0;
  if (refundAmount <= 0) return false;

  await User.findByIdAndUpdate(order.user_id, {
    $inc: { wallet_balance: refundAmount },
  });

  order.refund_method = 'WALLET_BALANCE';
  order.refund_amount = refundAmount;
  order.refund_reason = reason;
  order.refunded_at = new Date();

  return true;
};

/**
 * Restores stock for all items in a cancelled/refunded order.
 */
const restoreStock = async (items) => {
  for (const item of items) {
    try {
      await Product.findOneAndUpdate(
        { 'variants.sku': item.product_sku },
        {
          $inc: {
            'variants.$.stock_quantity': item.quantity,
            total_stock: item.quantity,
          },
        }
      );
    } catch (err) {
      // Log but don't fail — stock restoration is best-effort.
      console.error(`Stock restore failed for SKU ${item.product_sku}:`, err.message);
    }
  }
};

/**
 * Increments coupon usage count after a successful order.
 */
const incrementCouponUsage = async (couponCode) => {
  if (!couponCode) return;
  await Coupon.findOneAndUpdate({ coupon_code: couponCode }, { $inc: { usage_count: 1 } });
};

// ---------------------------------------------------------------------------
// Place order
// ---------------------------------------------------------------------------

/**
 * POST /api/orders
 * Converts the user's cart into an order.
 *
 * Body: {
 *   address_id or address: { label, street_address, city, state, country },
 *   payment_method: 'BANK_TRANSFER' | 'CASH_ON_DELIVERY' | 'CARD' | 'WALLET_BALANCE',
 *   phone: string   (contact phone for this delivery)
 * }
 */
exports.placeOrder = catchAsync(async (req, res) => {
  const { address, payment_method, phone } = req.body;

  if (!address) throw new ApiError(400, 'Delivery address is required');
  if (!payment_method) throw new ApiError(400, 'payment_method is required');
  if (!phone) throw new ApiError(400, 'Contact phone is required');

  const VALID_PAYMENT_METHODS = ['BANK_TRANSFER', 'CASH_ON_DELIVERY', 'CARD', 'WALLET_BALANCE'];
  if (!VALID_PAYMENT_METHODS.includes(payment_method)) {
    throw new ApiError(400, `payment_method must be one of: ${VALID_PAYMENT_METHODS.join(', ')}`);
  }

  // --- Load and validate cart ---
  const cart = await Cart.findOne({ user_id: String(req.user._id) });
  if (!cart || cart.items.length === 0) {
    throw new ApiError(400, 'Your cart is empty');
  }

  // --- Wallet balance payment: verify sufficient funds ---
  if (payment_method === 'WALLET_BALANCE') {
    const user = await User.findById(req.user._id);
    if (user.wallet_balance < cart.subtotal) {
      throw new ApiError(400, 'Insufficient wallet balance to place this order');
    }
    // Deduct wallet immediately.
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { wallet_balance: -cart.subtotal },
    });
  }

  // --- Decrement stock atomically for each item ---
  const stockErrors = [];
  for (const item of cart.items) {
    try {
      await Product.decrementStock(
        // decrementStock needs productId — find via SKU
        (await Product.findOne({ 'variants.sku': item.product_sku }))._id,
        item.product_sku,
        item.quantity
      );
    } catch (err) {
      stockErrors.push(`${item.product_sku}: ${err.message}`);
    }
  }

  if (stockErrors.length > 0) {
    // Refund wallet deduction if stock failed.
    if (payment_method === 'WALLET_BALANCE') {
      await User.findByIdAndUpdate(req.user._id, {
        $inc: { wallet_balance: cart.subtotal },
      });
    }
    throw new ApiError(400, `Stock issues: ${stockErrors.join('; ')}`);
  }

  // --- Build the order ---
  // Determine which warehouse fulfils this order.
  // If the user has a warehouse_id (set via warehouseScope on admin flows),
  // use it. For customer-facing place-order, derive from the first product's warehouse.
  let warehouse_id = req.warehouseId || null;
  if (!warehouse_id && cart.items.length > 0) {
    const firstProduct = await Product.findOne(
      { 'variants.sku': cart.items[0].product_sku },
      { warehouse_id: 1 }
    );
    warehouse_id = firstProduct?.warehouse_id || null;
  }

  const order = new Order({
    order_code: generateOrderCode(),
    cart_code: cart.cart_code,
    user_id: req.user._id,
    warehouse_id,
    user_details: {
      first_name: req.user.first_name,
      last_name: req.user.last_name,
      email: req.user.email,
      phone,
      address,
    },
    cart_details: {
      items: cart.items,
      coupon_code: cart.coupon_code || null,
      coupon_discount: cart.coupon_discount || 0,
      shipping_charges: cart.shipping_charges || 0,
      shipping_type: cart.shipping_type || null,
      subtotal: cart.subtotal,
    },
    status: payment_method === 'CASH_ON_DELIVERY' ? 'PENDING' : 'PENDING_PAYMENT',
    payment_method,
  });

  await order.save({ validateBeforeSave: false });

  // --- Increment coupon usage ---
  await incrementCouponUsage(cart.coupon_code);

  // --- Clear the cart ---
  cart.items = [];
  cart.is_coupon_applied = false;
  cart.coupon_code = undefined;
  cart.coupon_discount = 0;
  cart.shipping_charges = 0;
  cart.subtotal = 0;
  await cart.save();

  // --- Notify customer ---
  notifyUser(order, 'ORDER_PLACED').catch(() => {});
  sendInvoiceEmail(order).catch(() => {});

  // --- Record income transaction ---
  createOrderTransaction(order).catch((err) =>
    console.error(`[Transaction] Failed to record for ${order.order_code}:`, err.message)
  );

  res.status(201).json({
    success: true,
    message: 'Order placed successfully',
    data: { order },
  });
});

// ---------------------------------------------------------------------------
// Customer — view own orders
// ---------------------------------------------------------------------------

/** GET /api/orders
 *  Returns the authenticated user's orders, newest first. */
exports.getMyOrders = catchAsync(async (req, res) => {
  const { page = 1, limit = 10, status } = req.query;
  const filter = { user_id: req.user._id };
  if (status) filter.status = status;

  const skip = (Number(page) - 1) * Number(limit);
  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ created_at: -1 }).skip(skip).limit(Number(limit)),
    Order.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      orders,
      pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
    },
  });
});

/** GET /api/orders/:id */
exports.getOrder = catchAsync(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, user_id: req.user._id });
  if (!order) throw new ApiError(404, 'Order not found');
  res.status(200).json({ success: true, data: { order } });
});

// ---------------------------------------------------------------------------
// Customer — cancel own order
// ---------------------------------------------------------------------------

/**
 * POST /api/orders/:id/cancel
 * A customer can only cancel while status is PENDING, CONFIRMED, or PENDING_PAYMENT.
 * Body: { cancellation_reason }
 */
exports.cancelOrder = catchAsync(async (req, res) => {
  const { cancellation_reason } = req.body;
  if (!cancellation_reason) throw new ApiError(400, 'cancellation_reason is required');

  const order = await Order.findOne({ _id: req.params.id, user_id: req.user._id });
  if (!order) throw new ApiError(404, 'Order not found');

  // ── EDGE CASE 1: Block cancellation once processing has started ──────────
  if (!CUSTOMER_CANCELLABLE_STATUSES.includes(order.status)) {
    throw new ApiError(
      403,
      `Your order cannot be cancelled because it is already ${order.status.toLowerCase().replace(/_/g, ' ')}. Please contact support.`
    );
  }

  // Process refund if payment was already captured.
  const refunded = await processRefund(order, cancellation_reason);

  order.status = refunded ? 'REFUNDED' : 'CANCELLED';
  order.cancellation_reason = cancellation_reason;
  order.cancelled_at = new Date();

  await order.save({ validateBeforeSave: false });
  await restoreStock(order.cart_details?.items || []);

  // Notify customer of cancellation or refund.
  notifyUser(order, order.status).catch(() => {});

  res.status(200).json({
    success: true,
    message: refunded
      ? 'Order cancelled and refund has been credited to your wallet'
      : 'Order cancelled successfully',
    data: { order },
  });
});

// ---------------------------------------------------------------------------
// Rider — update delivery status
// ---------------------------------------------------------------------------

/**
 * PATCH /api/orders/:id/rider-update
 *
 * ── EDGE CASE 2: Rider rules ──────────────────────────────────────────────
 *  - Rider can ONLY update to DELIVERED or FAILED_DELIVERY.
 *  - Rider can ONLY update orders that are assigned to them.
 *  - delivery_failure_reason is required when status = FAILED_DELIVERY.
 *
 * Body: { status: 'DELIVERED' | 'FAILED_DELIVERY', delivery_failure_reason? }
 */
exports.riderUpdateOrder = catchAsync(async (req, res) => {
  const { status, delivery_failure_reason } = req.body;

  const RIDER_ALLOWED_STATUSES = ['DELIVERED', 'FAILED_DELIVERY'];
  if (!RIDER_ALLOWED_STATUSES.includes(status)) {
    throw new ApiError(
      403,
      `Riders can only update order status to: ${RIDER_ALLOWED_STATUSES.join(' or ')}`
    );
  }

  if (status === 'FAILED_DELIVERY' && !delivery_failure_reason) {
    throw new ApiError(400, 'delivery_failure_reason is required when marking delivery as failed');
  }

  // Verify this order is assigned to the requesting rider.
  const order = await Order.findById(req.params.id);
  if (!order) throw new ApiError(404, 'Order not found');

  if (!order.rider_id || String(order.rider_id) !== String(req.user._id)) {
    throw new ApiError(403, 'You are not assigned to this order');
  }

  if (order.status !== 'OUT_FOR_DELIVERY') {
    throw new ApiError(400, 'Order must be OUT_FOR_DELIVERY before you can update it');
  }

  order.status = status;

  if (status === 'FAILED_DELIVERY') {
    order.delivery_failure = delivery_failure_reason;
  }

  if (status === 'DELIVERED') {
    order.delivered_at = new Date();
  }

  await order.save({ validateBeforeSave: false });

  // Notify customer of delivery outcome.
  notifyUser(order, order.status).catch(() => {});

  res.status(200).json({
    success: true,
    message: `Order marked as ${status.toLowerCase().replace(/_/g, ' ')}`,
    data: { order },
  });
});

// ---------------------------------------------------------------------------
// Admin — full order management
// ---------------------------------------------------------------------------

/** GET /api/admin/orders — all orders with filters */
exports.adminGetAllOrders = catchAsync(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    status,
    payment_method,
    user_id,
    rider_id,
    from_date,
    to_date,
    sort = '-created_at',
  } = req.query;

  // Start with the warehouse scope injected by warehouseScope middleware.
  const filter = { ...req.warehouseFilter };

  if (status) filter.status = status;
  if (payment_method) filter.payment_method = payment_method;
  if (user_id) filter.user_id = user_id;
  if (rider_id) filter.rider_id = rider_id;
  if (from_date || to_date) {
    filter.created_at = {};
    if (from_date) filter.created_at.$gte = new Date(from_date);
    if (to_date) filter.created_at.$lte = new Date(to_date);
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [orders, total] = await Promise.all([
    Order.find(filter).sort(sort).skip(skip).limit(Number(limit)),
    Order.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      orders,
      pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
    },
  });
});

/** GET /api/admin/orders/:id */
exports.adminGetOrder = catchAsync(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, ...req.warehouseFilter });
  if (!order) throw new ApiError(404, 'Order not found');
  res.status(200).json({ success: true, data: { order } });
});

/**
 * PATCH /api/admin/orders/:id/status
 */
exports.adminUpdateOrderStatus = catchAsync(async (req, res) => {
  const { status, cancellation_reason } = req.body;
  if (!status) throw new ApiError(400, 'status is required');

  const order = await Order.findOne({ _id: req.params.id, ...req.warehouseFilter });
  if (!order) throw new ApiError(404, 'Order not found');

  if (TERMINAL_STATUSES.includes(order.status)) {
    throw new ApiError(400, `Order is already in a terminal state: ${order.status}`);
  }

  const allowed = ADMIN_STATUS_TRANSITIONS[order.status];
  if (!allowed || !allowed.includes(status)) {
    throw new ApiError(
      400,
      `Cannot transition from ${order.status} to ${status}. Allowed: ${(allowed || []).join(', ')}`
    );
  }

  order.status = status;

  if (status === 'DELIVERED') {
    order.delivered_at = new Date();
  }

  if (status === 'CANCELLED') {
    if (!cancellation_reason) throw new ApiError(400, 'cancellation_reason is required when cancelling');
    order.cancellation_reason = cancellation_reason;
    order.cancelled_at = new Date();

    await restoreStock(order.cart_details?.items || []);

    // ── EDGE CASE 3: Refund rules ─────────────────────────────────────────
    // COD orders that were never delivered → no money collected → just cancel.
    // All other payment methods → credit wallet.
    const refunded = await processRefund(order, cancellation_reason);
    if (refunded) order.status = 'REFUNDED';
  }

  await order.save({ validateBeforeSave: false });

  // Notify customer. Use final order.status (may have become REFUNDED after cancel).
  notifyUser(order, order.status).catch(() => {});

  res.status(200).json({
    success: true,
    message: `Order status updated to ${order.status}`,
    data: { order },
  });
});

/**
 * PATCH /api/admin/orders/:id/assign-rider
 * Assigns a rider (user with role 'rider') to the order.
 * Body: { rider_id }
 */
exports.adminAssignRider = catchAsync(async (req, res) => {
  const { rider_id } = req.body;
  if (!rider_id) throw new ApiError(400, 'rider_id is required');

  const rider = await User.findById(rider_id);
  if (!rider || rider.user_role !== 'rider') {
    throw new ApiError(404, 'Rider not found');
  }

  // Rider must belong to the same warehouse (unless admin is super-admin).
  if (!req.isSuperAdmin && rider.warehouse_id &&
      String(rider.warehouse_id) !== String(req.warehouseId)) {
    throw new ApiError(403, 'You can only assign riders from your own warehouse');
  }

  const order = await Order.findOne({ _id: req.params.id, ...req.warehouseFilter });
  if (!order) throw new ApiError(404, 'Order not found');

  if (!['CONFIRMED', 'PROCESSING', 'OUT_FOR_DELIVERY'].includes(order.status)) {
    throw new ApiError(400, 'Rider can only be assigned to CONFIRMED, PROCESSING, or OUT_FOR_DELIVERY orders');
  }

  order.rider_id = rider._id;
  order.rider_details = {
    first_name: rider.first_name,
    last_name: rider.last_name,
    phone_number: rider.phone_number,
  };

  await order.save({ validateBeforeSave: false });

  // Notify customer that a rider has been assigned.
  notifyUser(order, 'RIDER_ASSIGNED').catch(() => {});

  res.status(200).json({
    success: true,
    message: 'Rider assigned successfully',
    data: { order },
  });
});

/**
 * POST /api/admin/orders/:id/refund
 * Manual refund trigger — credits wallet regardless of order status.
 * Useful for partial refunds or dispute resolution.
 * Body: { reason, amount? }  — if amount omitted, full order subtotal is used.
 */
exports.adminRefund = catchAsync(async (req, res) => {
  const { reason, amount } = req.body;
  if (!reason) throw new ApiError(400, 'reason is required');

  const order = await Order.findOne({ _id: req.params.id, ...req.warehouseFilter });
  if (!order) throw new ApiError(404, 'Order not found');

  if (order.status === 'REFUNDED') {
    throw new ApiError(400, 'Order has already been refunded');
  }

  // ── EDGE CASE 3 (COD): COD orders can only be refunded if delivered ──────
  if (order.payment_method === 'CASH_ON_DELIVERY' && order.status !== 'DELIVERED') {
    throw new ApiError(
      400,
      'Cash on delivery orders can only be refunded after they have been delivered'
    );
  }

  // Admin can refund from any non-refunded status, including DELIVERED.
  // For non-COD, no delivery requirement — refund is always wallet credit.

  const refundAmount = amount
    ? parseFloat(amount)
    : order.cart_details?.subtotal || 0;

  if (refundAmount <= 0) throw new ApiError(400, 'Refund amount must be greater than zero');

  await User.findByIdAndUpdate(order.user_id, {
    $inc: { wallet_balance: refundAmount },
  });

  order.refund_method = 'WALLET_BALANCE';
  order.refund_amount = refundAmount;
  order.refund_reason = reason;
  order.refunded_at = new Date();
  order.status = 'REFUNDED';

  await order.save({ validateBeforeSave: false });

  // Notify customer of the refund.
  notifyUser(order, 'REFUNDED').catch(() => {});

  res.status(200).json({
    success: true,
    message: `Refund of ${refundAmount} credited to customer wallet`,
    data: { order },
  });
});

// ---------------------------------------------------------------------------
// Admin — orders list  (paginated, date-ranged, warehouse-scoped)
// ---------------------------------------------------------------------------

/**
 * GET /api/orders/admin/list
 *
 * Query params:
 *   from            — ISO date string, start of range (inclusive)
 *   to              — ISO date string, end of range (inclusive, end-of-day)
 *   page            — page number (default 1)
 *   items_per_page  — max 15 (default 15)
 *   warehouse_id    — override warehouse scope (super-admin only)
 *   status          — filter by order status
 *   payment_method  — filter by payment method
 */
exports.getOrdersList = catchAsync(async (req, res) => {
  const {
    from,
    to,
    page = 1,
    items_per_page,
    status,
    payment_method,
  } = req.query;

  // ── items_per_page hard cap at 15 ────────────────────────────────────────
  const limit = Math.min(parseInt(items_per_page) || 15, 15);
  const skip  = (Math.max(parseInt(page), 1) - 1) * limit;

  // ── warehouse_id query-param override (super-admin only) ─────────────────
  // warehouseScope has already populated req.warehouseFilter / req.isSuperAdmin.
  // A super-admin can further narrow to a specific warehouse via ?warehouse_id=.
  let filter = { ...req.warehouseFilter };

  if (req.query.warehouse_id) {
    if (!req.isSuperAdmin) {
      throw new ApiError(403, 'Only super-admins can override the warehouse filter');
    }
    filter.warehouse_id = req.query.warehouse_id;
  }

  // ── Date range ────────────────────────────────────────────────────────────
  if (from || to) {
    filter.created_at = {};
    if (from) filter.created_at.$gte = new Date(from);
    if (to) {
      const endOfDay = new Date(to);
      endOfDay.setHours(23, 59, 59, 999);
      filter.created_at.$lte = endOfDay;
    }
  }

  if (status)         filter.status         = status;
  if (payment_method) filter.payment_method = payment_method;

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .select(
        'order_code status payment_method payment_provider user_details.first_name ' +
        'user_details.last_name user_details.email cart_details.subtotal ' +
        'warehouse_id created_at'
      ),
    Order.countDocuments(filter),
  ]);

  const pages = Math.ceil(total / limit);

  res.status(200).json({
    success: true,
    data: {
      orders,
      pagination: {
        total,
        page:           parseInt(page),
        items_per_page: limit,
        pages,
      },
      filters_applied: {
        from:           from  || null,
        to:             to    || null,
        status:         status         || null,
        payment_method: payment_method || null,
        warehouse_id:   filter.warehouse_id || null,
      },
    },
  });
});

// ---------------------------------------------------------------------------
// Admin — orders report  (PDF download)
// ---------------------------------------------------------------------------

/**
 * GET /api/orders/admin/report
 *
 * Same query params as getOrdersList. Fetches ALL matching orders (no
 * items_per_page restriction for the report — paginated only to avoid
 * loading millions at once; the PDF covers one page worth per request).
 * Returns a PDF download with a summary table + per-order detail rows.
 */
exports.getOrdersReport = catchAsync(async (req, res) => {
  const PDFDocument = require('pdfkit');

  const {
    from,
    to,
    page = 1,
    items_per_page,
    status,
    payment_method,
  } = req.query;

  const limit = Math.min(parseInt(items_per_page) || 15, 15);
  const skip  = (Math.max(parseInt(page), 1) - 1) * limit;

  let filter = { ...req.warehouseFilter };

  if (req.query.warehouse_id) {
    if (!req.isSuperAdmin) {
      throw new ApiError(403, 'Only super-admins can override the warehouse filter');
    }
    filter.warehouse_id = req.query.warehouse_id;
  }

  if (from || to) {
    filter.created_at = {};
    if (from) filter.created_at.$gte = new Date(from);
    if (to) {
      const endOfDay = new Date(to);
      endOfDay.setHours(23, 59, 59, 999);
      filter.created_at.$lte = endOfDay;
    }
  }

  if (status)         filter.status         = status;
  if (payment_method) filter.payment_method = payment_method;

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit),
    Order.countDocuments(filter),
  ]);

  // ── Aggregate summary figures ─────────────────────────────────────────────
  const totalRevenue   = orders.reduce((s, o) => s + (o.cart_details?.subtotal || 0), 0);
  const statusCounts   = {};
  orders.forEach((o) => {
    statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
  });

  // ── Build PDF ─────────────────────────────────────────────────────────────
  const PlatformSettings = require('../models/platformSettings');
  const settings = await PlatformSettings.findOne();
  const companyName = settings?.name || 'Open Commerce';

  const doc    = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));

  const pdfDone = new Promise((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });

  // ── Palette ───────────────────────────────────────────────────────────────
  const DARK        = '#222222';
  const GREY        = '#888888';
  const LIGHT_GREY  = '#f0f0f0';
  const WAVE_LIGHT  = '#c8c8c8';
  const WAVE_DARK   = '#3a3a3a';
  const W = doc.page.width;
  const L = 40;
  const R = W - 40;

  const currency = (n) => `$${(parseFloat(n) || 0).toFixed(2)}`;
  const fmtDate  = (d) => d ? new Date(d).toLocaleDateString('en-GB') : '—';

  // ── HEADER ────────────────────────────────────────────────────────────────
  let y = 40;

  // Logo placeholder
  doc.rect(L, y, 70, 30).fillAndStroke(LIGHT_GREY, LIGHT_GREY);
  doc.fillColor(GREY).fontSize(8).font('Helvetica')
     .text('YOUR LOGO', L + 6, y + 11);

  // Title — top right
  doc.fillColor(DARK).fontSize(20).font('Helvetica-Bold')
     .text('ORDERS REPORT', 0, y + 6, { align: 'right', width: W - 40 });

  y += 46;

  // Company + date range subtitle
  doc.fontSize(9).font('Helvetica').fillColor(GREY)
     .text(`${companyName}  ·  Generated: ${fmtDate(new Date())}`, L, y);
  if (from || to) {
    doc.text(`Period: ${from ? fmtDate(from) : '—'}  to  ${to ? fmtDate(to) : '—'}`, L, y + 12);
    y += 12;
  }

  y += 22;

  // ── SUMMARY BOXES ─────────────────────────────────────────────────────────
  const BOX_W = (R - L - 20) / 3;
  const boxes = [
    { label: 'Total Orders',   value: String(total) },
    { label: 'Page Revenue',   value: currency(totalRevenue) },
    { label: 'This Page',      value: `${orders.length} / ${limit}` },
  ];

  boxes.forEach((box, i) => {
    const bx = L + i * (BOX_W + 10);
    doc.rect(bx, y, BOX_W, 44).fill(LIGHT_GREY);
    doc.fillColor(GREY).fontSize(8).font('Helvetica')
       .text(box.label, bx + 10, y + 8);
    doc.fillColor(DARK).fontSize(16).font('Helvetica-Bold')
       .text(box.value, bx + 10, y + 20);
  });

  y += 58;

  // ── STATUS BREAKDOWN ──────────────────────────────────────────────────────
  if (Object.keys(statusCounts).length > 0) {
    doc.fontSize(9).font('Helvetica-Bold').fillColor(DARK)
       .text('Status breakdown:', L, y);
    y += 13;
    const statusLine = Object.entries(statusCounts)
      .map(([s, c]) => `${s}: ${c}`)
      .join('   ·   ');
    doc.fontSize(8).font('Helvetica').fillColor(GREY)
       .text(statusLine, L, y, { width: R - L });
    y += 20;
  }

  // Divider
  doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(DARK).stroke();
  y += 12;

  // ── TABLE HEADER ──────────────────────────────────────────────────────────
  const COL = {
    no:       L,
    code:     L + 20,
    customer: L + 120,
    status:   L + 240,
    payment:  L + 310,
    total:    L + 400,
    date:     L + 455,
  };
  const ROW_H = 20;

  doc.rect(L, y, R - L, ROW_H).fill(DARK);
  doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold')
     .text('#',          COL.no       + 2, y + 6)
     .text('Order Code', COL.code     + 2, y + 6)
     .text('Customer',   COL.customer + 2, y + 6)
     .text('Status',     COL.status   + 2, y + 6)
     .text('Payment',    COL.payment  + 2, y + 6)
     .text('Total',      COL.total    + 2, y + 6)
     .text('Date',       COL.date     + 2, y + 6);

  y += ROW_H;

  // ── TABLE ROWS ────────────────────────────────────────────────────────────
  orders.forEach((order, idx) => {
    // Page break — leave room for wave footer (130 px)
    if (y > doc.page.height - 150) {
      doc.addPage();
      y = 40;
    }

    if (idx % 2 === 0) {
      doc.rect(L, y, R - L, ROW_H).fill('#f9f9f9');
    }

    const customerName = [
      order.user_details?.first_name,
      order.user_details?.last_name,
    ].filter(Boolean).join(' ') || '—';

    doc.fillColor(DARK).fontSize(7.5).font('Helvetica')
       .text(String(skip + idx + 1),              COL.no       + 2, y + 6)
       .text(order.order_code,                    COL.code     + 2, y + 6, { width: 96 })
       .text(customerName,                        COL.customer + 2, y + 6, { width: 114 })
       .text(order.status,                        COL.status   + 2, y + 6, { width: 66 })
       .text(order.payment_method,                COL.payment  + 2, y + 6, { width: 86 })
       .text(currency(order.cart_details?.subtotal), COL.total + 2, y + 6, { width: 52 })
       .text(fmtDate(order.created_at),           COL.date     + 2, y + 6, { width: 60 });

    y += ROW_H;
  });

  // Final divider
  doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(DARK).stroke();
  y += 14;

  // Pagination note
  const pages = Math.ceil(total / limit);
  doc.fontSize(8).font('Helvetica').fillColor(GREY)
     .text(
       `Page ${page} of ${pages}  ·  Showing ${orders.length} of ${total} orders`,
       L, y, { align: 'center', width: R - L }
     );

  // ── WAVE FOOTER (last page) ───────────────────────────────────────────────
  const pH = doc.page.height;
  doc.moveTo(0, pH - 110)
     .bezierCurveTo(W * 0.3, pH - 50,  W * 0.5, pH - 150, W * 0.75, pH - 85)
     .bezierCurveTo(W * 0.85, pH - 55, W * 0.92, pH - 38, W,        pH - 65)
     .lineTo(W, pH).lineTo(0, pH).closePath().fill(WAVE_LIGHT);

  doc.moveTo(W * 0.45, pH - 8)
     .bezierCurveTo(W * 0.6, pH - 85, W * 0.75, pH - 48, W, pH - 18)
     .lineTo(W, pH).lineTo(W * 0.45, pH).closePath().fill(WAVE_DARK);

  doc.end();
  await pdfDone;

  const pdfBuffer = Buffer.concat(chunks);
  const filename  = `orders-report-${Date.now()}.pdf`;

  res.set({
    'Content-Type':        'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length':      pdfBuffer.length,
  });
  res.send(pdfBuffer);
});

// ---------------------------------------------------------------------------
// Public — order tracking
// ---------------------------------------------------------------------------

/**
 * GET /api/orders/track/:orderCode
 *
 * Public endpoint — no authentication required.
 * Returns only the order_code and current status to avoid leaking
 * customer or cart details to unauthenticated callers.
 *
 * Response: { order_code: "ORD-xxx", status: "DELIVERED" }
 */
exports.trackOrder = catchAsync(async (req, res) => {
  const order = await Order.findOne({ order_code: req.params.orderCode })
    .select('order_code status');

  if (!order) throw new ApiError(404, 'No order found with that code');

  res.status(200).json({
    order_code: order.order_code,
    status:     order.status,
  });
});
