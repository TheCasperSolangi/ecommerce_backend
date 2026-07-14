const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema(
  {
        ticket_code: {type:String, required: true},
        customer_id: {type:String, required: true}, // user id 
        order_code: {type:String, required: true}, // any purchased order
        ticket_type: {type: String, required: true, enum: ['REFUND_REQUEST', 'REPLACEMENT_REQUEST', 'EMPTY_PARCEL_RECEVIED', 'DEFECTED_PRODUCT_RECIEVED', 'WRONG_ITEM_RECEIVED', 'PRODUCT_DAMAGED', 'OTHERS']},
        ticket_description: {type:String},
        attachments: [String],
        status: {type:String, required: true, enum: ['OPEN', 'CLOSED', 'UNDER_REVIEW']},
        notes_by_team: {type:String, required: true}, // such as we have revieweed your case and issued the refund
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
   
  }
);

module.exports = mongoose.model('Tickets', ticketSchema);