const mongoose = require('mongoose');

const bannersSchema = new mongoose.Schema(
  {
    banner_id:    { type: String, required: true, unique: true },
    banner_type:  { type: String, required: true, enum: ['POP-UP', 'SLIDER', 'APP_BANNER', 'HEADER_BANNER'], index: true },
    image:        { type: String, default: null },  // URL — null for HEADER_BANNER
    heading:      { type: String, default: null },
    text:         { type: String, default: null },
    action_type:  { type: String, required: true, enum: ['BUTTON', 'HYPERLINK'] },
    action_url:   { type: String, default: null },
    // Controls storefront visibility and sort order.
    is_active:     { type: Boolean, default: true,  index: true },
    display_order: { type: Number,  default: 0 },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

module.exports = mongoose.model('Banners', bannersSchema);