// seed-platform-settings.js

const mongoose = require('mongoose');
const PlatformSetting = require('./src/models/platformSettings'); // Update path accordingly

const MONGO_URI = "mongodb://127.0.0.1:27017/opencom"

async function seed() {
  try {
    await mongoose.connect(MONGO_URI);

    const existing = await PlatformSetting.findOne();

    if (existing) {
      console.log('Platform settings already exist.');
      process.exit(0);
    }

    await PlatformSetting.create({
      enviroment: 'PRODUCTION',
      platform_logo: 'http://localhost:4755/api/uploads/2d3cf928-9267-480e-8aa8-fa88495d98d7.png',
      version: 'v1.0.0',
      name: 'OpenCommerce',
      tagline: 'Open Source Commerce Platform',
      footer_text: '© OpenCommerce. All rights reserved.',

      social_links: {
        facebook: '',
        instagram: '',
        whatsapp: '',
        youtube: '',
        x: ''
      },

      privacy_policy_url: '/privacy-policy.md',
      terms_of_serivce_url: '/terms-of-service.md',
      refund_policy_url: '/refund-policy.md'
    });

    console.log('✅ Platform settings seeded successfully.');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
  } finally {
    await mongoose.disconnect();
  }
}

seed();