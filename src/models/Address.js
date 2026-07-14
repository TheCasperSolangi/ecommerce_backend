const mongoose = require('mongoose');
const slugify = require('slugify');



const addressSchema = new mongoose.Schema(
  {
    label: {type:String, required: true},
    street_address: {type:String, required: true},
    city: {type:String, required: true},
    state: {type:String, required: true},
    country: {type:String, required: true}
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
   
  }
);

module.exports = mongoose.model('Address', addressSchema);