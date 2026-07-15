const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema(
  {
    vendor_code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    full_name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone_number: { type: String, trim: true },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    notes: { type: String, default: '' },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

module.exports = mongoose.model('Vendors', vendorSchema);
