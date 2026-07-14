const mongoose = require('mongoose');
const slugify = require('slugify');


const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    alt_text: { type: String, default: '' },
    is_primary: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const dimensionsSchema = new mongoose.Schema(
  {
    length: { type: Number, min: 0 },
    width: { type: Number, min: 0 },
    height: { type: Number, min: 0 },
    unit: { type: String, enum: ['cm', 'in'], default: 'cm' },
  },
  { _id: false }
);

const variantSchema = new mongoose.Schema({
  sku: { type: String, required: true, trim: true, uppercase: true },
  barcode: { type: String, default: null, trim: true }, // UPC/EAN
  attributes: {
    // e.g. { color: 'Red', size: 'L' }
    type: Map,
    of: String,
    default: {},
  },
  price: { type: Number, required: true, min: 0 },
  compare_at_price: { type: Number, min: 0, default: null }, // "MSRP" / strike-through price
  cost_price: { type: Number, min: 0, default: null, select: false }, // internal margin tracking
  currency: { type: String, default: 'USD', uppercase: true, minlength: 3, maxlength: 3 },

  stock_quantity: { type: Number, required: true, min: 0, default: 0 },
  low_stock_threshold: { type: Number, min: 0, default: 5 },
  allow_backorder: { type: Boolean, default: false },

  weight: { type: Number, min: 0, default: null }, // grams
  dimensions: { type: dimensionsSchema, default: () => ({}) },

  images: { type: [imageSchema], default: [] },

  is_active: { type: Boolean, default: true },
});

variantSchema.virtual('is_in_stock').get(function isInStock() {
  return this.allow_backorder || this.stock_quantity > 0;
});

variantSchema.virtual('is_low_stock').get(function isLowStock() {
  return this.stock_quantity > 0 && this.stock_quantity <= this.low_stock_threshold;
});

variantSchema.virtual('discount_percentage').get(function discountPercentage() {
  if (!this.compare_at_price || this.compare_at_price <= this.price) return 0;
  return Math.round(((this.compare_at_price - this.price) / this.compare_at_price) * 100);
});

const seoSchema = new mongoose.Schema(
  {
    meta_title: { type: String, maxlength: 70, default: null },
    meta_description: { type: String, maxlength: 160, default: null },
    meta_keywords: { type: [String], default: [] },
  },
  { _id: false }
);


const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      maxlength: 200,
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      index: true,
    },

    description: { type: String, default: '' },
    short_description: { type: String, maxlength: 300, default: '' },

    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brand',
      default: null,
    }, // can be set as No-Brand

    categories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        required: true,
      },
    ],


    tags: { type: [String], default: [], index: true },

      attributes: {
      type: Map,
      of: String,
      default: {},
    },

    variants: {
      type: [variantSchema],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'A product must have at least one variant',
      },
    },

     min_price: { type: Number, min: 0, index: true },
    max_price: { type: Number, min: 0 },
    total_stock: { type: Number, min: 0, default: 0 },

    images: { type: [imageSchema], default: [] }, // product-level gallery (variant images override per-variant)

    status: {
      type: String,
      enum: ['draft', 'active', 'archived'],
      default: 'draft',
      index: true,
    },
    is_featured: { type: Boolean, default: false, index: true },
    published_at: { type: Date, default: null },

    ratings_average: { type: Number, min: 0, max: 5, default: 0 },
    ratings_count: { type: Number, min: 0, default: 0 },

    shipping_class: {
      type: String,
      enum: ['standard', 'oversized', 'fragile', 'digital'],
      default: 'standard',
    },
    is_taxable: { type: Boolean, default: true },
    tax_class: { type: String, default: 'standard' },

    seo: { type: seoSchema, default: () => ({}) },

    is_deleted: { type: Boolean, default: false, index: true },
    deleted_at: { type: Date, default: null },

    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Warehouse this product's stock lives in.
    warehouse_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Warehouses',
      default: null,
      index: true,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

productSchema.index({ name: 'text', description: 'text', tags: 'text' });

productSchema.index({ status: 1, is_deleted: 1, categories: 1 });
productSchema.index({ status: 1, is_deleted: 1, is_featured: 1 });
productSchema.index({ status: 1, is_deleted: 1, min_price: 1 });
productSchema.index({ 'variants.sku': 1 }, { unique: true, sparse: true });

productSchema.pre('validate', function generateSlug(next) {
  if (this.isModified('name') || !this.slug) {
    this.slug = slugify(this.name, { lower: true, strict: true });
  }
  next();
});

productSchema.pre('save', function syncDenormalizedFields(next) {
  if (this.variants && this.variants.length > 0) {
    const activeVariants = this.variants.filter((v) => v.is_active);
    const pool = activeVariants.length > 0 ? activeVariants : this.variants;

    const prices = pool.map((v) => v.price);
    this.min_price = Math.min(...prices);
    this.max_price = Math.max(...prices);
    this.total_stock = this.variants.reduce((sum, v) => sum + (v.stock_quantity || 0), 0);
  }

  if (this.isModified('status') && this.status === 'active' && !this.published_at) {
    this.published_at = new Date();
  }

  next();
});

function excludeDeleted(next) {
  if (this.getFilter().is_deleted === undefined) {
    this.where({ is_deleted: { $ne: true } });
  }
  next();
}
productSchema.pre(/^find/, excludeDeleted);

productSchema.statics.findDeleted = function findDeleted(filter = {}) {
  return this.find({ ...filter, is_deleted: true });
};

productSchema.methods.softDelete = function softDelete() {
  this.is_deleted = true;
  this.deleted_at = new Date();
  this.status = 'archived';
  return this.save();
};

productSchema.methods.getVariantBySku = function getVariantBySku(sku) {
  return this.variants.find((v) => v.sku === sku.toUpperCase());
};

productSchema.statics.decrementStock = async function decrementStock(productId, sku, quantity) {
  const result = await this.findOneAndUpdate(
    { _id: productId, 'variants.sku': sku.toUpperCase(), 'variants.stock_quantity': { $gte: quantity } },
    { $inc: { 'variants.$.stock_quantity': -quantity, total_stock: -quantity } },
    { new: true }
  );
  if (!result) {
    throw new Error('Insufficient stock or product/variant not found');
  }
  return result;
};

module.exports = mongoose.model('Product', productSchema);