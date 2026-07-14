const mongoose = require('mongoose');
const slugify = require('slugify');



const warehouseSchema = new mongoose.Schema(
  {
    warehouse_code: {type:String, required: true},
    name: {type:String, required: true},
    city: {type:String, required: true},
    state: {type:String, required: true},
    country: {type:String, required: true}
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
   
  }
);

module.exports = mongoose.model('Warehouses', warehouseSchema);