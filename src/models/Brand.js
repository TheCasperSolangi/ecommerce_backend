const mongoose = require('mongoose');
const slugify = require('slugify');

const seoSchema = new mongoose.Schema(
  {
    meta_title: { type: String, maxlength: 70, default: null },
    meta_description: { type: String, maxlength: 160, default: null },
    meta_keywords: { type: [String], default: [] },
  },
  { _id: false }
);

const socialLinksSchema = new mongoose.Schema(
  {
    website: { type: String, default: null },
    instagram: { type: String, default: null },
    facebook: { type: String, default: null },
    twitter: { type: String, default: null },
  },
  { _id: false }
);

const brandSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Brand name is required'],
      trim: true,
      unique: true,
      maxlength: 100,
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      index: true,
    },

    description: { type: String, default: '' },
    logo: { type: String, default: null },
    banner_image: { type: String, default: null }, 

   
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    social_links: { type: socialLinksSchema, default: () => ({}) },

    status: {
      type: String,
      enum: ['active', 'inactive', 'pending_approval'],
      default: 'active',
      index: true,
    },
    is_featured: { type: Boolean, default: false, index: true },

   
    product_count: { type: Number, default: 0, min: 0 },

    seo: { type: seoSchema, default: () => ({}) },

    is_deleted: { type: Boolean, default: false, index: true },
    deleted_at: { type: Date, default: null },

    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

brandSchema.index({ name: 'text', description: 'text' });
brandSchema.index({ status: 1, is_deleted: 1, is_featured: 1 });

brandSchema.pre('validate', function generateSlug(next) {
  if (this.isModified('name') || !this.slug) {
    this.slug = slugify(this.name, { lower: true, strict: true });
  }
  next();
});

function excludeDeleted(next) {
  if (this.getFilter().is_deleted === undefined) {
    this.where({ is_deleted: { $ne: true } });
  }
  next();
}
brandSchema.pre(/^find/, excludeDeleted);

brandSchema.statics.findDeleted = function findDeleted(filter = {}) {
  return this.find({ ...filter, is_deleted: true });
};

brandSchema.statics.findActive = function findActive() {
  return this.find({ status: 'active' }).sort({ name: 1 });
};

brandSchema.methods.softDelete = async function softDelete() {
  const Product = mongoose.model('Product');
  const hasProducts = await Product.exists({ brand: this._id });
  if (hasProducts) {
    throw new Error('Cannot delete a brand that still has products assigned to it.');
  }
  this.is_deleted = true;
  this.deleted_at = new Date();
  this.status = 'inactive';
  return this.save();
};

module.exports = mongoose.model('Brand', brandSchema);