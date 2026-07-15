const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema(
  {
    coupon_code: { type: String, required: true },
    discount_type: {
      type: String,
      required: true,
      enum: ['FLAT_FIAT', 'CAPED_PERCENTAGE'],
    },
    eligibility_type: {
      type: String,
      required: true,
      enum: ['NEW_CUSTOMERS', 'SPECIFIC_CUSTOMERS', 'EVERYONE', 'SELECTED_CARD_TYPES'],
    },
    eligible_customers: [String],
    new_customer_date_till: { type: Date },
    eligible_cards: [String],
    value: { type: Number, required: true },
    capped_at: { type: Number },
    available_across_all_products: { type: Boolean, default: true },
    is_selected_products_only: { type: Boolean, default: false },
    product_ids: [String],
    is_active: { type: Boolean, default: true },
    expires_at: { type: Date },
    usage_limit: { type: Number, default: null },
    usage_count: { type: Number, default: 0 },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

module.exports = mongoose.model('Coupons', couponSchema);
