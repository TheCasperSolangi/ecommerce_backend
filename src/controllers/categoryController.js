const Category = require('../models/Category');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BLOCKED_FIELDS = [
  'slug', 'ancestors', 'level', 'product_count',
  'is_deleted', 'deleted_at', 'created_by', 'updated_by',
];

const pickAllowed = (body, extras = []) => {
  const blocked = [...BLOCKED_FIELDS, ...extras];
  const result = {};
  Object.keys(body).forEach((key) => {
    if (!blocked.includes(key)) result[key] = body[key];
  });
  return result;
};

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/** GET /api/categories
 *  Query: page, limit, parent, status, featured, search, sort */
exports.getAllCategories = catchAsync(async (req, res) => {
  const {
    page = 1,
    limit = 50,
    parent,     // filter by parent id; pass 'root' for top-level only
    status,
    featured,
    search,
    sort = 'display_order',
  } = req.query;

  const filter = {};
  if (parent === 'root') filter.parent = null;
  else if (parent) filter.parent = parent;
  if (status) filter.status = status;
  if (featured !== undefined) filter.is_featured = featured === 'true';
  if (search) filter.$text = { $search: search };

  const skip = (Number(page) - 1) * Number(limit);

  const [categories, total] = await Promise.all([
    Category.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(Number(limit))
      .populate('parent', 'name slug')
      .select('-__v'),
    Category.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      categories,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    },
  });
});

/** GET /api/categories/:idOrSlug */
exports.getCategory = catchAsync(async (req, res) => {
  const { idOrSlug } = req.params;
  const isId = idOrSlug.match(/^[a-f\d]{24}$/i);
  const category = isId
    ? await Category.findById(idOrSlug).populate('parent', 'name slug').select('-__v')
    : await Category.findOne({ slug: idOrSlug }).populate('parent', 'name slug').select('-__v');

  if (!category) throw new ApiError(404, 'Category not found');

  res.status(200).json({ success: true, data: { category } });
});

/** GET /api/categories/:id/descendants — full subtree */
exports.getCategoryDescendants = catchAsync(async (req, res) => {
  const category = await Category.findById(req.params.id).select('_id name');
  if (!category) throw new ApiError(404, 'Category not found');

  const descendants = await Category.findDescendants(category._id).select('-__v');

  res.status(200).json({ success: true, data: { descendants } });
});

// ---------------------------------------------------------------------------
// Admin — create / update / delete
// ---------------------------------------------------------------------------

/** POST /api/categories */
exports.createCategory = catchAsync(async (req, res) => {
  const data = pickAllowed(req.body);
  data.created_by = req.user._id;

  const category = new Category(data);
  await category.save();

  res.status(201).json({
    success: true,
    message: 'Category created successfully',
    data: { category },
  });
});

/** PATCH /api/categories/:id */
exports.updateCategory = catchAsync(async (req, res) => {
  const data = pickAllowed(req.body);
  data.updated_by = req.user._id;

  const category = await Category.findById(req.params.id);
  if (!category) throw new ApiError(404, 'Category not found');

  Object.assign(category, data);
  await category.save(); // pre-save hook re-syncs ancestors/level if parent changed

  res.status(200).json({
    success: true,
    message: 'Category updated successfully',
    data: { category },
  });
});

/** DELETE /api/categories/:id — soft delete */
exports.deleteCategory = catchAsync(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw new ApiError(404, 'Category not found');

  // softDelete() throws if category has children.
  await category.softDelete();

  res.status(200).json({ success: true, message: 'Category deleted successfully' });
});
