const mongoose = require('mongoose');
const slugify = require('slugify');



const couponSchema = new mongoose.Schema(
  {
    coupon_code: {type:String, required: true},
    discount_type: {type:String, required: true, enum: ['FLAT_FIAT', 'CAPED_PERCENTAGE']},
    eligibility_type: {type:String, required: true, enum: ['NEW_CUSTOMERS', 'SPECIFIC_CUSTOMERS', 'EVERYONE', 'SELECTED_CARD_TYPES']},
    // if specific customers
    eligible_customers: [String], //their user ids
    new_customer_date_till: {type:Date}, // their date from which they can be determined as new customers.
    eligible_cards: [String], // incase specific card such as MASTERCARD, VISA, AMEX
    value: {type:Number, required: true},
    capped_at: {type:Number},
    available_across_all_products: {type:Boolean},
    is_selected_products_only: {type:Boolean},
    product_ids: [String]
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
   
  }
);

module.exports = mongoose.model('Coupons', couponSchema);