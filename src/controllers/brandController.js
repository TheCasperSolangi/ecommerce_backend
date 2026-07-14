const Brand = require('../models/Brand');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fields a caller can never set directly — computed or privileged. */
const BLOCKED_FIELDS = ['slug', 'product_count', 'is_deleted', 'deleted_at', 'created_by', 'updated_by'];

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

/** GET /api/brands
 *  Query: page, limit, status, featured, search, sort */
exports.getAllBrands = catchAsync(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    status,
    featured,
    search,
    sort = 'name',
  } = req.query;

  const filter = {};
  if (status) filter.status = status;
  if (featured !== undefined) filter.is_featured = featured === 'true';
  if (search) filter.$text = { $search: search };

  const skip = (Number(page) - 1) * Number(limit);

  const [brands, total] = await Promise.all([
    Brand.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(Number(limit))
      .select('-__v'),
    Brand.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      brands,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    },
  });
});

/** GET /api/brands/:idOrSlug */
exports.getBrand = catchAsync(async (req, res) => {
  const { idOrSlug } = req.params;
  const isId = idOrSlug.match(/^[a-f\d]{24}$/i);
  const brand = isId
    ? await Brand.findById(idOrSlug).select('-__v')
    : await Brand.findOne({ slug: idOrSlug }).select('-__v');

  if (!brand) throw new ApiError(404, 'Brand not found');

  res.status(200).json({ success: true, data: { brand } });
});

// ---------------------------------------------------------------------------
// Admin — create / update / delete
// ---------------------------------------------------------------------------

/** POST /api/brands */
exports.createBrand = catchAsync(async (req, res) => {
  const data = pickAllowed(req.body);
  data.created_by = req.user._id;

  const brand = await Brand.create(data);

  res.status(201).json({
    success: true,
    message: 'Brand created successfully',
    data: { brand },
  });
});

/** PATCH /api/brands/:id */
exports.updateBrand = catchAsync(async (req, res) => {
  const data = pickAllowed(req.body);
  data.updated_by = req.user._id;

  const brand = await Brand.findById(req.params.id);
  if (!brand) throw new ApiError(404, 'Brand not found');

  Object.assign(brand, data);
  await brand.save();

  res.status(200).json({
    success: true,
    message: 'Brand updated successfully',
    data: { brand },
  });
});

/** DELETE /api/brands/:id  — soft delete */
exports.deleteBrand = catchAsync(async (req, res) => {
  const brand = await Brand.findById(req.params.id);
  if (!brand) throw new ApiError(404, 'Brand not found');

  // softDelete() throws if the brand still has products assigned.
  await brand.softDelete();

  res.status(200).json({ success: true, message: 'Brand deleted successfully' });
});
