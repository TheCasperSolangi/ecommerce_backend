const express = require('express');
const paymentController = require('../controllers/paymentController');
const authenticate = require('../middleware/authenticate');

const router = express.Router();

// All payment routes require an authenticated customer.
router.use(authenticate);

// ── Stripe ────────────────────────────────────────────────────────────────────
// Step 1: create PaymentIntent → returns client_secret to frontend
router.post('/stripe/intent', paymentController.stripeCreateIntent);

// Step 2: frontend calls stripe.confirmPayment(), then hits this endpoint.
// Server pulls the PaymentIntent from Stripe to verify — no trust from client.
router.post('/stripe/confirm', paymentController.stripeConfirmPayment);

// ── PayPal ────────────────────────────────────────────────────────────────────
// Step 1: create PayPal order → returns paypal_order_id to frontend
router.post('/paypal/create-order', paymentController.paypalCreateOrder);

// Step 2: frontend shows PayPal popup, user approves, then hits this endpoint.
// Server captures the payment from PayPal directly — no client-side capture.
router.post('/paypal/capture', paymentController.paypalCapturePayment);

module.exports = router;
