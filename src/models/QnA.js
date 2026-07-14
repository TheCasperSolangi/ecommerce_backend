const mongoose = require('mongoose');

const questionsSchema = new mongoose.Schema(
  {
    question_code: { type: String, required: true, unique: true },

    // Who asked.
    asked_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    asked_by_details: {
      first_name:      { type: String, required: true },
      last_name:       { type: String, required: true },
      profile_picture: { type: String, default: null },
    },

    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },

    question:  { type: String, required: true, maxlength: 1000 },
    answer:    { type: String, default: null },

    // Who answered (admin / customer_support / marketing).
    answered_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    answered_at: { type: Date, default: null },

    status: {
      type: String,
      required: true,
      enum: ['ASKED', 'ANSWERED'],
      default: 'ASKED',
      index: true,
    },

    // Audit flags.
    is_question_edited: { type: Boolean, default: false },
    is_answer_edited:   { type: Boolean, default: false },
    is_deleted:         { type: Boolean, default: false, index: true },
    deleted_at:         { type: Date,    default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// Fast product-level Q&A listing.
questionsSchema.index({ product_id: 1, is_deleted: 1, status: 1, created_at: -1 });

module.exports = mongoose.model('Questions', questionsSchema);