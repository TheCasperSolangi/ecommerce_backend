const mongoose = require('mongoose');
const slugify = require('slugify');



const cartSchema = new mongoose.Schema(
  {
    cart_code: {type:String, required: true},
    user_id: {type:String, required: true},
    items: [
        {
            product_sku: {type:String, required: true},
            quantity: {type:Number, required: true},
            price: {type:Number, required: true}

        }
    ],
    is_coupon_applied: {type:Boolean},
    coupon_code: {type:String},
    coupon_discount: {type:Number}, // calculated discount such as even if capped and the discount is 250 USD then just 250
    shipping_charges: {type:Number},
    subtotal: {type:Number}
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
   
  }
);

module.exports = mongoose.model('Carts', cartSchema);