const mongoose = require('mongoose');
const slugify = require('slugify');



const shippingSchema = new mongoose.Schema(
  {
    shipping_type: {type:String, required: true, enum: ['EXPRESS', 'INSTANT', 'SCHEDULED', 'STANDARD']},
    instant_delivery_estimated_time: {type:Number}, // number of minute 
    express_delivery_days: {type:Number}, // such as 3,4,5
    standard_delivery_time: {type:Number},
    is_free_shipping: {type:Boolean},
    city_to_city_free_shipping: {type:Boolean},
    price: [
         {
            city: {type:String},
            state: {type:String},
            price: {type:String}
        }
    ]
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
   
  }
);

module.exports = mongoose.model('Shippings', shippingSchema);