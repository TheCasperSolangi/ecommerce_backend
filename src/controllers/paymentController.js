const Stripe = require('stripe');
const { Client, Environment, OrdersController, PaymentsController } = require('@paypal/paypal-server-sdk');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Products');
const Coupon = require('../models/Coupon');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const sendEmail = require('../utils/sendEmail');
const { sendPushToMany } = require('../utils/pushNotification');
const { sendInvoiceEmail } = require('./orderController');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Provider clients (lazy-initialised)
// ---------------------------------------------------------------------------

let _stripe = null;
const getStripe = () => {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  _stripe = new Stripe(key, { apiVersion: '2024-06-20' });
  return _stripe;
};

let _paypalOrdersCtrl = null;
let _paypalPaymentsCtrl = null;
const getPayPal = () => {
  if (_paypalOrdersCtrl) return { orders: _paypalOrdersCtrl, payments: _paypalPaymentsCtrl };

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set');

  const env = process.env.NODE_ENV === 'production'
    ? Environment.Production
    : Environment.Sandbox;

  const client = new Client({
    clientCredentialsAuthCredentials: { oAuthClientId: clientId, oAuthClientSecret: clientSecret },
    environment: env,
  });

  _paypalOrdersCtrl = new OrdersController(client);
  _paypalPaymentsCtrl = new PaymentsController(client);
  return { orders: _paypalOrdersCtrl, payments: _paypalPaymentsCtrl };
};

// ---------------------------------------------------------------------------
// Shared helpers (mirrors orderController helpers — kept here to avoid circular dep)
// ---------------------------------------------------------------------------

const generateOrderCode = () =>
  `ORD-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

const decrementStockForCart = async (cartItems) => {
  const errors = [];
  for (const item of cartItems) {
    try {
      const prod = await Product.findOne({ 'variants.sku': item.product_sku });
      if (!prod) throw new Error('Product not found');
      await Product.decrementStock(prod._id, item.product_sku, item.quantity);
    } catch (err) {
      errors.push(`${item.product_sku}: ${err.message}`);
    }
  }
  return errors;
};

const incrementCouponUsage = async (couponCode) => {
  if (!couponCode) return;
  await Coupon.findOneAndUpdate({ coupon_code: couponCode }, { $inc: { usage_count: 1 } });
};

const clearCart = async (cart) => {
  cart.items = [];
  cart.is_coupon_applied = false;
  cart.coupon_code = undefined;
  cart.coupon_discount = 0;
  cart.shipping_charges = 0;
  cart.subtotal = 0;
  await cart.save();
};

/** Advance a PENDING_PAYMENT order to CONFIRMED after successful payment capture. */
const confirmOrderPayment = async (order, provider, intentId) => {
  order.status = 'CONFIRMED';
  order.payment_provider = provider;
  order.payment_intent_id = intentId;
  await order.save({ validateBeforeSave: false });

  // Send invoice email after online payment confirmation.
  sendInvoiceEmail(order).catch(() => { });

  // Notify customer
  const user = await User.findById(order.user_id).select('email push_tokens');
  if (!user) return;

  try {
    await sendEmail({
      to: user.email,
      subject: `Payment Successful — ${order.order_code}`,
      html: `<p>Hi ${order.user_details?.first_name},</p>
             <p>Your payment for order <strong>${order.order_code}</strong> has been received and the order is now confirmed.</p>
             <p>Total charged: <strong>${order.cart_details?.subtotal}</strong></p>`,
    });
  } catch (e) {
    console.error('[Payment notify] Email failed:', e.message);
  }

  const tokens = (user.push_tokens || []).map((t) => t.token).filter(Boolean);
  if (tokens.length) {
    sendPushToMany(tokens, 'Payment Confirmed 💳', `Payment for order ${order.order_code} was successful.`, {
      order_id: String(order._id), event: 'PAYMENT_CONFIRMED',
    }).catch(() => { });
  }
};

// ---------------------------------------------------------------------------
// ── STRIPE ──────────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

/**
 * POST /api/payments/stripe/intent
 *
 * Step 1 — creates a Stripe PaymentIntent for the user's cart subtotal.
 * Also creates the pending Order record so we have an order_code before payment.
 *
 * Body: { address, phone }
 * Returns: { client_secret, order_id, order_code, amount, currency }
 */
exports.stripeCreateIntent = catchAsync(async (req, res) => {
  const { address, phone } = req.body;

  if (!address) throw new ApiError(400, 'Delivery address is required');
  if (!phone) throw new ApiError(400, 'Contact phone is required');

  const cart = await Cart.findOne({ user_id: String(req.user._id) });
  if (!cart || cart.items.length === 0) throw new ApiError(400, 'Your cart is empty');

  const amountInCents = Math.round((cart.subtotal || 0) * 100);
  if (amountInCents < 50) throw new ApiError(400, 'Order total is below the minimum chargeable amount');

  const currency = process.env.DEFAULT_CURRENCY || 'usd';

  // Create the PaymentIntent server-side.
  const stripe = getStripe();
  const intent = await stripe.paymentIntents.create({
    amount: amountInCents,
    currency,
    // Metadata ties the intent to our internal order code for auditability.
    metadata: {
      user_id: String(req.user._id),
      cart_code: cart.cart_code,
    },
    // automatic_payment_methods lets the frontend use any Stripe-supported method.
    automatic_payment_methods: { enabled: true },
  });

  // Derive warehouse from first cart item's product.
  let warehouse_id = null;
  if (cart.items.length > 0) {
    const p = await Product.findOne({ 'variants.sku': cart.items[0].product_sku }, { warehouse_id: 1 });
    warehouse_id = p?.warehouse_id || null;
  }

  // Create the Order in PENDING_PAYMENT state — stock is NOT yet decremented.
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
    status: 'PENDING_PAYMENT',
    payment_method: 'CARD',
    payment_provider: 'stripe',
    payment_intent_id: intent.id,
  });

  await order.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    data: {
      client_secret: intent.client_secret,   // sent to frontend to call stripe.confirmPayment()
      order_id: order._id,
      order_code: order.order_code,
      amount: cart.subtotal,
      currency,
    },
  });
});

/**
 * POST /api/payments/stripe/confirm
 *
 * Step 2 — called by the client AFTER stripe.confirmPayment() succeeds.
 * The server independently retrieves the PaymentIntent from Stripe and
 * verifies its status before confirming the order.
 *
 * Body: { order_id, payment_intent_id }
 */
exports.stripeConfirmPayment = catchAsync(async (req, res) => {
  const { order_id, payment_intent_id } = req.body;

  if (!order_id || !payment_intent_id) {
    throw new ApiError(400, 'order_id and payment_intent_id are required');
  }

  // Load the pending order — must belong to this user.
  const order = await Order.findOne({ _id: order_id, user_id: req.user._id });
  if (!order) throw new ApiError(404, 'Order not found');

  if (order.status !== 'PENDING_PAYMENT') {
    throw new ApiError(400, `Order is already ${order.status}`);
  }

  // Ensure the intent_id matches what we created — prevents tampering.
  if (order.payment_intent_id !== payment_intent_id) {
    throw new ApiError(400, 'Payment intent does not match this order');
  }

  // ── Server-side verification — we pull the intent from Stripe directly ──
  const stripe = getStripe();
  let intent;
  try {
    intent = await stripe.paymentIntents.retrieve(payment_intent_id);
  } catch (err) {
    throw new ApiError(502, 'Could not verify payment with Stripe');
  }

  if (intent.status !== 'succeeded') {
    throw new ApiError(402, `Payment not completed. Stripe status: ${intent.status}`);
  }

  // Verify amount matches — guards against partial-payment attacks.
  const expectedCents = Math.round((order.cart_details?.subtotal || 0) * 100);
  if (intent.amount_received !== expectedCents) {
    throw new ApiError(402, 'Payment amount does not match the order total');
  }

  // Decrement stock now that payment is confirmed.
  const stockErrors = await decrementStockForCart(order.cart_details?.items || []);
  if (stockErrors.length > 0) {
    // Stock issue after payment — flag for manual resolution but still confirm.
    console.error('[Stripe confirm] Stock errors after payment:', stockErrors);
  }

  await incrementCouponUsage(order.cart_details?.coupon_code);

  // Clear the cart.
  const cart = await Cart.findOne({ cart_code: order.cart_code });
  if (cart) await clearCart(cart);

  // Confirm the order and notify.
  await confirmOrderPayment(order, 'stripe', intent.id);

  res.status(200).json({
    success: true,
    message: 'Payment confirmed. Your order is now being processed.',
    data: { order },
  });
});

// ---------------------------------------------------------------------------
// ── PAYPAL ───────────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

/**
 * POST /api/payments/paypal/create-order
 *
 * Step 1 — creates a PayPal Order and returns its id to the frontend
 * so the PayPal JS SDK can launch the approval flow.
 *
 * Body: { address, phone }
 * Returns: { paypal_order_id, order_id, order_code, amount, currency }
 */
exports.paypalCreateOrder = catchAsync(async (req, res) => {
  const { address, phone } = req.body;

  if (!address) throw new ApiError(400, 'Delivery address is required');
  if (!phone) throw new ApiError(400, 'Contact phone is required');

  const cart = await Cart.findOne({ user_id: String(req.user._id) });
  if (!cart || cart.items.length === 0) throw new ApiError(400, 'Your cart is empty');

  const currency = (process.env.DEFAULT_CURRENCY || 'USD').toUpperCase();
  const amount = (cart.subtotal || 0).toFixed(2);

  const { orders: ordersCtrl } = getPayPal();

  let paypalOrder;
  try {
    const response = await ordersCtrl.ordersCreate({
      body: {
        intent: 'CAPTURE',
        purchaseUnits: [
          {
            amount: { currencyCode: currency, value: amount },
            description: `Order for ${req.user.email}`,
            customId: cart.cart_code,  // ties PayPal record to our cart
          },
        ],
      },
    });
    paypalOrder = response.result;
  } catch (err) {
    throw new ApiError(502, 'Could not create PayPal order');
  }

  // Derive warehouse
  let warehouse_id = null;
  if (cart.items.length > 0) {
    const p = await Product.findOne({ 'variants.sku': cart.items[0].product_sku }, { warehouse_id: 1 });
    warehouse_id = p?.warehouse_id || null;
  }

  // Create internal Order in PENDING_PAYMENT state.
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
    status: 'PENDING_PAYMENT',
    payment_method: 'CARD',
    payment_provider: 'paypal',
    payment_intent_id: paypalOrder.id,   // PayPal Order ID stored here
  });

  await order.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    data: {
      paypal_order_id: paypalOrder.id,  // frontend passes this to PayPal JS SDK
      order_id: order._id,
      order_code: order.order_code,
      amount,
      currency,
    },
  });
});

/**
 * POST /api/payments/paypal/capture
 *
 * Step 2 — called by the client after the user approves in the PayPal popup.
 * The server captures the payment via PayPal API and verifies the captured
 * amount before confirming the order.
 *
 * Body: { order_id, paypal_order_id }
 */
exports.paypalCapturePayment = catchAsync(async (req, res) => {
  const { order_id, paypal_order_id } = req.body;

  if (!order_id || !paypal_order_id) {
    throw new ApiError(400, 'order_id and paypal_order_id are required');
  }

  const order = await Order.findOne({ _id: order_id, user_id: req.user._id });
  if (!order) throw new ApiError(404, 'Order not found');

  if (order.status !== 'PENDING_PAYMENT') {
    throw new ApiError(400, `Order is already ${order.status}`);
  }

  if (order.payment_intent_id !== paypal_order_id) {
    throw new ApiError(400, 'PayPal order ID does not match this order');
  }

  // ── Server-side capture — we initiate capture, not the client ──────────
  const { orders: ordersCtrl } = getPayPal();
  let captureResult;
  try {
    const response = await ordersCtrl.ordersCapture({
      id: paypal_order_id,
    });
    captureResult = response.result;
  } catch (err) {
    throw new ApiError(502, `PayPal capture failed: ${err.message}`);
  }

  // Verify capture completed successfully.
  if (captureResult.status !== 'COMPLETED') {
    throw new ApiError(402, `PayPal payment not completed. Status: ${captureResult.status}`);
  }

  // Verify amount captured matches our order total.
  const capture = captureResult.purchaseUnits?.[0]?.payments?.captures?.[0];
  if (!capture) {
    throw new ApiError(502, 'Could not read PayPal capture details');
  }

  const capturedAmount = parseFloat(capture.amount?.value || '0');
  const expectedAmount = parseFloat((order.cart_details?.subtotal || 0).toFixed(2));

  if (Math.abs(capturedAmount - expectedAmount) > 0.01) {
    throw new ApiError(402, 'Captured amount does not match the order total');
  }

  // Decrement stock.
  const stockErrors = await decrementStockForCart(order.cart_details?.items || []);
  if (stockErrors.length > 0) {
    console.error('[PayPal capture] Stock errors after payment:', stockErrors);
  }

  await incrementCouponUsage(order.cart_details?.coupon_code);

  // Clear the cart.
  const cart = await Cart.findOne({ cart_code: order.cart_code });
  if (cart) await clearCart(cart);

  // Confirm the order and notify.
  await confirmOrderPayment(order, 'paypal', paypal_order_id);

  res.status(200).json({
    success: true,
    message: 'Payment captured. Your order is now being processed.',
    data: { order },
  });
});
