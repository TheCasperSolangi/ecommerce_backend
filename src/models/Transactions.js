const mongoose = require('mongoose');

const transactionsSchema = new mongoose.Schema(
  {
    transaction_code:     { type: String, required: true, unique: true },
    transaction_title:    { type: String, required: true },
    type:                 { type: String, required: true, enum: ['INCOME', 'EXPENSE'] },
    amount:               { type: Number, required: true, min: 0 },
    currency:             { type: String, default: 'USD', uppercase: true, maxlength: 3 },
    is_vendor:            { type: Boolean, default: false },
    vendor_code:          { type: String, default: null }, // vendor identifier
    is_refund:            { type: Boolean, default: false },
    is_order_transaction: { type: Boolean, default: false },
    order_code:           { type: String, default: null },
    notes:                { type: String, default: '' },
    // Who created this entry — user_id for manual entries, order user_id for auto entries.
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// Fast lookups by type and date for reporting.
transactionsSchema.index({ type: 1, created_at: -1 });
transactionsSchema.index({ order_code: 1 });

module.exports = mongoose.model('Transactions', transactionsSchema);