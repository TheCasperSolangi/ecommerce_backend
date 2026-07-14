const mongoose = require('mongoose');
const slugify = require('slugify');

const platformSettings = new mongoose.Schema(
  {
    enviroment: {type:String, required: true, enum: ['PRODUCTION', 'DEVELOPMENT']},
    version: {type:String, required: true}, // "v1.20.09"
    name: {type:String, required: true, default: "Open Commerce"},
    tagline: {type:String, required: true},
    footer_text: {type:String, required: true},
    social_links: {
        facebook: {type:String},
        instagram: {type:String},
        whatsapp: {type:String},
        youtube: {type:String},
        x: {type:String}
    },
    privacy_policy_url: {type:String}, // md file for privacy policy
    terms_of_serivce_url: {type:String},
    refund_policy_url: {type:String},

  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
   
  }
);

module.exports = mongoose.model('PlatformSetting', platformSettings);