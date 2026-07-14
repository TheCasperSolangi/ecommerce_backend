const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema(
  {
    order_code: { type: String, required: true },
    cart_code:  { type: String, required: true },

    // Warehouse that fulfils this order.
    warehouse_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Warehouses',
      default: null,
      index: true,
    },

    // Owning customer — stored as ObjectId for queries + denormalized for display.
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    user_details: {
      first_name: { type: String, required: true },
      last_name:  { type: String, required: true },
      email:      { type: String, required: true },
      phone:      { type: String, required: true },
      address: {
        label:          { type: String, required: true },
        street_address: { type: String, required: true },
        city:           { type: String, required: true },
        state:          { type: String, required: true },
        country:        { type: String, required: true },
      },
    },

    // Snapshot of the cart at the time of order placement.
    cart_details: { type: mongoose.Schema.Types.Mixed, default: {} },

    status: {
      type: String,
      required: true,
      enum: [
        'PENDING', 'CONFIRMED', 'PENDING_PAYMENT', 'PROCESSING',
        'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'REFUNDED',
        'FAILED_DELIVERY', 'RE_ATTEMPT_DELIVERY',
      ],
      default: 'PENDING',
      index: true,
    },

    payment_method: {
      type: String,
      required: true,
      enum: ['BANK_TRANSFER', 'CASH_ON_DELIVERY', 'CARD', 'WALLET_BALANCE'],
    },

    // Online payment provider details — populated when payment_method is CARD.
    payment_provider: {
      type: String,
      enum: ['stripe', 'paypal', null],
      default: null,
    },
    // Stripe PaymentIntent ID (pi_xxx) or PayPal Order ID
    payment_intent_id: { type: String, default: null, index: true, sparse: true },

    // Populated only after a refund is processed.
    refund_method:  { type: String, enum: ['WALLET_BALANCE', 'CARD'], default: null },
    refund_amount:  { type: Number, default: null },
    refund_reason:  { type: String, default: null },
    refunded_at:    { type: Date, default: null },

    // Populated when a rider is assigned.
    rider_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    rider_details: {
      first_name:   { type: String, default: null },
      last_name:    { type: String, default: null },
      phone_number: { type: String, default: null },
    },

    // Populated only on cancellation.
    cancellation_reason: { type: String, default: null },
    cancelled_at:        { type: Date, default: null },

    // Populated on successful delivery.
    delivered_at: { type: Date, default: null },

    // Populated on failed delivery.
    delivery_failure: { type: String, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// Compound index for warehouse-scoped admin queries.
orderSchema.index({ warehouse_id: 1, status: 1, created_at: -1 });
orderSchema.index({ warehouse_id: 1, user_id: 1 });

module.exports = mongoose.model('Orders', orderSchema);