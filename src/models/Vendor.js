const mongoose = require('mongoose');
const slugify = require('slugify');

const vendorSchema = new mongoose.Schema(
  {
        vendor_code: {type:String, required: true},
        full_name: {type:String, required: true},
        email: {type:String}
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
   
  }
);

module.exports = mongoose.model('Vendors', vendorSchema);