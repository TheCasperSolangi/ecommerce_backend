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

// Lightweight breadcrumb entry, denormalized onto each category so the
// full ancestor chain (name + slug) can be read without extra queries/joins.
const ancestorSchema = new mongoose.Schema(
  {
    _id: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
    name: String,
    slug: String,
  },
  { _id: false }
);

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Category name is required'],
      trim: true,
      maxlength: 100,
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      index: true,
    },

    description: { type: String, default: '' },
    image: { type: String, default: null }, // category banner/thumbnail URL
    icon: { type: String, default: null }, // small icon for nav/menus

    // Hierarchy: null parent = top-level category.
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
      index: true,
    },
    // Full ancestor chain, root-first, for fast breadcrumbs & subtree queries.
    ancestors: { type: [ancestorSchema], default: [] },
    // Depth in the tree; 0 = top level. Useful for capping nesting depth in the UI.
    level: { type: Number, default: 0, min: 0 },

    // Manual ordering within a level (e.g. drag-and-drop admin UI).
    display_order: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
      index: true,
    },
    is_featured: { type: Boolean, default: false },

    // Denormalized count of active, non-deleted products directly in this
    // category. Maintained by the product service on create/delete/move,
    // not by Mongoose hooks here (cross-collection counts don't belong in
    // a single-document pre-save hook).
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

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

categorySchema.index({ name: 'text', description: 'text' });
categorySchema.index({ parent: 1, status: 1, is_deleted: 1 });
categorySchema.index({ 'ancestors._id': 1 }); // fast "all descendants of X" lookups

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

categorySchema.pre('validate', function generateSlug(next) {
  if (this.isModified('name') || !this.slug) {
    this.slug = slugify(this.name, { lower: true, strict: true });
  }
  next();
});

// Keep ancestors/level in sync whenever a category is created or re-parented.
categorySchema.pre('save', async function syncAncestry(next) {
  if (!this.isModified('parent')) return next();

  if (!this.parent) {
    this.ancestors = [];
    this.level = 0;
    return next();
  }

  const Category = this.constructor;
  const parentDoc = await Category.findById(this.parent).select('name slug ancestors level');
  if (!parentDoc) {
    return next(new Error('Parent category not found'));
  }

  // Prevent cycles: a category can't become a descendant of itself.
  const wouldCycle = parentDoc.ancestors.some((a) => a._id.equals(this._id)) ||
    parentDoc._id.equals(this._id);
  if (wouldCycle) {
    return next(new Error('Cannot set a category or its own descendant as its parent'));
  }

  this.ancestors = [
    ...parentDoc.ancestors,
    { _id: parentDoc._id, name: parentDoc.name, slug: parentDoc.slug },
  ];
  this.level = parentDoc.level + 1;
  next();
});

function excludeDeleted(next) {
  if (this.getFilter().is_deleted === undefined) {
    this.where({ is_deleted: { $ne: true } });
  }
  next();
}
categorySchema.pre(/^find/, excludeDeleted);

// ---------------------------------------------------------------------------
// Statics & instance methods
// ---------------------------------------------------------------------------

categorySchema.statics.findDeleted = function findDeleted(filter = {}) {
  return this.find({ ...filter, is_deleted: true });
};

/** All descendants (any depth) of a given category, via the denormalized ancestors array. */
categorySchema.statics.findDescendants = function findDescendants(categoryId) {
  return this.find({ 'ancestors._id': categoryId });
};

categorySchema.statics.findTopLevel = function findTopLevel() {
  return this.find({ parent: null, status: 'active' }).sort({ display_order: 1 });
};

categorySchema.methods.softDelete = async function softDelete() {
  const hasChildren = await this.constructor.exists({ parent: this._id });
  if (hasChildren) {
    throw new Error('Cannot delete a category that has subcategories. Move or delete them first.');
  }
  this.is_deleted = true;
  this.deleted_at = new Date();
  this.status = 'inactive';
  return this.save();
};

module.exports = mongoose.model('Category', categorySchema);