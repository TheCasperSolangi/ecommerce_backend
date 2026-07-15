const mongoose = require('mongoose');
const Shipping = require('./src/models/shipping'); // Adjust path as needed

// Pakistani cities with their states/provinces
const PAKISTAN_CITIES = [
  // Punjab
  { city: 'Lahore', state: 'Punjab' },
  { city: 'Karachi', state: 'Sindh' },
  { city: 'Islamabad', state: 'Islamabad Capital Territory' },
  { city: 'Rawalpindi', state: 'Punjab' },
  { city: 'Faisalabad', state: 'Punjab' },
  { city: 'Multan', state: 'Punjab' },
  { city: 'Gujranwala', state: 'Punjab' },
  { city: 'Sargodha', state: 'Punjab' },
  { city: 'Bahawalpur', state: 'Punjab' },
  { city: 'Sialkot', state: 'Punjab' },
  // Sindh
  { city: 'Hyderabad', state: 'Sindh' },
  { city: 'Sukkur', state: 'Sindh' },
  { city: 'Larkana', state: 'Sindh' },
  // Khyber Pakhtunkhwa
  { city: 'Peshawar', state: 'Khyber Pakhtunkhwa' },
  { city: 'Abbottabad', state: 'Khyber Pakhtunkhwa' },
  { city: 'Mardan', state: 'Khyber Pakhtunkhwa' },
  { city: 'Swat', state: 'Khyber Pakhtunkhwa' },
  // Balochistan
  { city: 'Quetta', state: 'Balochistan' },
  { city: 'Gwadar', state: 'Balochistan' },
  { city: 'Turbat', state: 'Balochistan' },
  // Azad Kashmir
  { city: 'Muzaffarabad', state: 'Azad Kashmir' },
  { city: 'Mirpur', state: 'Azad Kashmir' },
  // Gilgit-Baltistan
  { city: 'Gilgit', state: 'Gilgit-Baltistan' },
  { city: 'Skardu', state: 'Gilgit-Baltistan' },
];

// Helper function to generate price array for all cities
const generatePrices = (basePrice, isFree = false) => {
  if (isFree) {
    return PAKISTAN_CITIES.map(({ city, state }) => ({
      city,
      state,
      price: '0'
    }));
  }
  
  return PAKISTAN_CITIES.map(({ city, state }) => ({
    city,
    state,
    price: String(Math.round(basePrice + (Math.random() * 200 - 100))) // Random variation
  }));
};

// Seed data for all shipping methods
const shippingMethods = [
  // 1. INSTANT Delivery (within city, 30-60 minutes)
  {
    shipping_type: 'INSTANT',
    instant_delivery_estimated_time: 30, // 30 minutes
    express_delivery_days: null,
    standard_delivery_time: null,
    is_free_shipping: false,
    city_to_city_free_shipping: false,
    price: generatePrices(299) // Base price Rs. 299
  },
  
  // 2. EXPRESS Delivery (1-3 days)
  {
    shipping_type: 'EXPRESS',
    instant_delivery_estimated_time: null,
    express_delivery_days: 2,
    standard_delivery_time: null,
    is_free_shipping: false,
    city_to_city_free_shipping: false,
    price: generatePrices(199) // Base price Rs. 199
  },
  
  // 3. STANDARD Delivery (4-7 days)
  {
    shipping_type: 'STANDARD',
    instant_delivery_estimated_time: null,
    express_delivery_days: null,
    standard_delivery_time: 5,
    is_free_shipping: false,
    city_to_city_free_shipping: false,
    price: generatePrices(99) // Base price Rs. 99
  },
  
  // 4. SCHEDULED Delivery (Free shipping for all cities)
  {
    shipping_type: 'SCHEDULED',
    instant_delivery_estimated_time: null,
    express_delivery_days: null,
    standard_delivery_time: null,
    is_free_shipping: true,
    city_to_city_free_shipping: true,
    price: generatePrices(0, true) // Free for all cities
  }
];

// Function to seed shipping methods
const seedShippingMethods = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect('mongodb://localhost:27017/opencom', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB');

    // Clear existing shipping methods (optional)
    await Shipping.deleteMany({});
    console.log('Cleared existing shipping methods');

    // Insert new shipping methods
    const result = await Shipping.insertMany(shippingMethods);
    console.log(`✅ Successfully seeded ${result.length} shipping methods`);
    console.log('Shipping methods seeded:', result.map(s => s.shipping_type).join(', '));

    // Display sample pricing for Karachi
    const karachiShipping = await Shipping.findOne({});
    if (karachiShipping) {
      console.log('\n📊 Sample Pricing for Karachi:');
      const allMethods = await Shipping.find({});
      allMethods.forEach(method => {
        const karachiPrice = method.price.find(p => p.city === 'Karachi');
        if (karachiPrice) {
          console.log(`${method.shipping_type}: Rs. ${karachiPrice.price}`);
        }
      });
    }

  } catch (error) {
    console.error('❌ Error seeding shipping methods:', error.message);
  } finally {
    // Close the connection
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  }
};

// Run the seed function
if (require.main === module) {
  seedShippingMethods();
}

module.exports = { seedShippingMethods, PAKISTAN_CITIES };