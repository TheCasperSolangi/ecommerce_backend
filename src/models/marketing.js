const mongoose = require('mongoose');
const slugify = require('slugify');



const marketingMessage = new mongoose.Schema(
  {
        message_code: {type:String, required: true},
        text: {type:String, required: true},
        image: { type: String, default: null },
        channels: [String], // enums: ['Whatsapp', 'Email', 'Push Notifications'],
        analytics: {
            delivered: {type:Number},
            clicked: {type:Number},
            failed: {type:Number}
        }

  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
   
  }
);

module.exports = mongoose.model('MarketingMessages', marketingMessage);