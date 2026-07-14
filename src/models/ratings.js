const mongoose = require('mongoose');

const RatingsSchema = new mongoose.Schema(
  {
    // Denormalized for display — no joins needed in listing queries.
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    user_details: {
      first_name:      { type: String, required: true },
      last_name:       { type: String, required: true },
      profile_picture: { type: String, default: null },
    },

    // One review per customer per product per order.
    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    product_sku:  { type: String, required: true },
    order_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Orders',
      required: true,
      index: true,
    },

    ratings_given:      { type: Number, required: true, min: 1, max: 5 },
    review_body:        { type: String, required: true, maxlength: 2000 },
    review_attachments: { type: [String], default: [], validate: { validator: (v) => v.length <= 3, message: 'Maximum 3 attachments allowed' } },

    // Audit flags.
    is_edited:  { type: Boolean, default: false },
    is_deleted: { type: Boolean, default: false, index: true },
    deleted_at: { type: Date,    default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// Enforce one review per user per product per order at the DB level.
RatingsSchema.index({ user_id: 1, product_id: 1, order_id: 1 }, { unique: true });
// Fast product-level aggregations.
RatingsSchema.index({ product_id: 1, is_deleted: 1, created_at: -1 });

module.exports = mongoose.model('Ratings', RatingsSchema);