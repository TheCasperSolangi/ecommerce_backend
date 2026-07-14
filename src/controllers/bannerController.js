const crypto = require('crypto');
const Banner = require('../models/banners');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const generateBannerId = () =>
  `BNR-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

/**
 * Validates the HEADER_BANNER edge case:
 *   - image must be absent / null
 *   - action_type must be HYPERLINK
 *
 * Throws ApiError if violated.
 */
const assertHeaderBannerRules = (data) => {
  if (data.image) {
    throw new ApiError(
      400,
      'HEADER_BANNER only supports text content — image is not allowed'
    );
  }
  if (data.action_type && data.action_type !== 'HYPERLINK') {
    throw new ApiError(
      400,
      'HEADER_BANNER action_type must be HYPERLINK'
    );
  }
};

/**
 * Builds a clean update/create payload, enforcing type-specific rules.
 * Strips banner_id so it can never be overwritten after creation.
 */
const buildPayload = (body, isCreate = false) => {
  const ALLOWED = [
    'banner_type', 'image', 'heading', 'text', 'action_type', 'action_url', 'is_active', 'display_order',
  ];

  const data = {};
  ALLOWED.forEach((f) => {
    if (f in body) data[f] = body[f];
  });

  const type = data.banner_type || (isCreate ? undefined : null);

  // Enforce HEADER_BANNER constraints.
  if (type === 'HEADER_BANNER') {
    assertHeaderBannerRules(data);
    // Force action_type to HYPERLINK even if the caller didn't send it.
    data.action_type = 'HYPERLINK';
    // Ensure image is null.
    data.image = null;
  }

  return data;
};

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/**
 * GET /api/banners
 * Returns all active banners, optionally filtered by type.
 * Public — used by the storefront to render the UI.
 *
 * Query: ?type=HEADER_BANNER | SLIDER | POP-UP | APP_BANNER
 */
exports.getAllBanners = catchAsync(async (req, res) => {
  const filter = { is_active: true };
  if (req.query.type) filter.banner_type = req.query.type;

  const banners = await Banner.find(filter)
    .sort({ display_order: 1, created_at: -1 })
    .select('-__v');

  res.status(200).json({ success: true, data: { banners } });
});

/**
 * GET /api/banners/:id — single banner by Mongo _id or banner_id
 */
exports.getBanner = catchAsync(async (req, res) => {
  const { id } = req.params;
  const isObjectId = id.match(/^[a-f\d]{24}$/i);

  const banner = isObjectId
    ? await Banner.findById(id).select('-__v')
    : await Banner.findOne({ banner_id: id }).select('-__v');

  if (!banner) throw new ApiError(404, 'Banner not found');

  res.status(200).json({ success: true, data: { banner } });
});

// ---------------------------------------------------------------------------
// Admin / Marketing — create, update, delete
// ---------------------------------------------------------------------------

/**
 * POST /api/banners
 *
 * Body: { banner_type, image?, heading?, text?, action_type, action_url?, is_active?, display_order? }
 *
 * Edge case — HEADER_BANNER:
 *   - image must be absent or null
 *   - action_type is forced to HYPERLINK regardless of what is sent
 */
exports.createBanner = catchAsync(async (req, res) => {
  const { banner_type, action_type } = req.body;

  if (!banner_type)  throw new ApiError(400, 'banner_type is required');
  if (!action_type)  throw new ApiError(400, 'action_type is required');

  const data = buildPayload(req.body, true);
  data.banner_id = generateBannerId();

  const banner = await Banner.create(data);

  res.status(201).json({
    success: true,
    message: 'Banner created successfully',
    data: { banner },
  });
});

/**
 * PATCH /api/banners/:id
 *
 * Partial update. HEADER_BANNER constraints are re-validated on every update.
 */
exports.updateBanner = catchAsync(async (req, res) => {
  const { id } = req.params;
  const isObjectId = id.match(/^[a-f\d]{24}$/i);

  const banner = isObjectId
    ? await Banner.findById(id)
    : await Banner.findOne({ banner_id: id });

  if (!banner) throw new ApiError(404, 'Banner not found');

  // Merge the incoming type with the stored type so the rule check has full context.
  const effectiveType = req.body.banner_type || banner.banner_type;

  // Validate HEADER_BANNER constraints against the merged state.
  if (effectiveType === 'HEADER_BANNER') {
    // image in incoming body OR already stored on the document
    const incomingImage = 'image' in req.body ? req.body.image : banner.image;
    const incomingActionType = req.body.action_type || banner.action_type;

    if (incomingImage) {
      throw new ApiError(400, 'HEADER_BANNER only supports text content — image is not allowed');
    }
    if (incomingActionType !== 'HYPERLINK') {
      throw new ApiError(400, 'HEADER_BANNER action_type must be HYPERLINK');
    }

    // Force-correct any type-mismatches silently.
    req.body.action_type = 'HYPERLINK';
    req.body.image = null;
  }

  const data = buildPayload(req.body);
  Object.assign(banner, data);
  await banner.save();

  res.status(200).json({
    success: true,
    message: 'Banner updated successfully',
    data: { banner },
  });
});

/**
 * DELETE /api/banners/:id — hard delete
 */
exports.deleteBanner = catchAsync(async (req, res) => {
  const { id } = req.params;
  const isObjectId = id.match(/^[a-f\d]{24}$/i);

  const banner = isObjectId
    ? await Banner.findByIdAndDelete(id)
    : await Banner.findOneAndDelete({ banner_id: id });

  if (!banner) throw new ApiError(404, 'Banner not found');

  res.status(200).json({ success: true, message: 'Banner deleted successfully' });
});

// ---------------------------------------------------------------------------
// Admin — list all (including inactive)
// ---------------------------------------------------------------------------

/**
 * GET /api/banners/admin/all
 * Returns all banners regardless of is_active status.
 * Supports filtering and pagination for the admin dashboard.
 *
 * Query: ?type, ?is_active, ?page, ?limit
 */
exports.adminGetAllBanners = catchAsync(async (req, res) => {
  const { type, is_active, page = 1, limit = 20 } = req.query;

  const filter = {};
  if (type)       filter.banner_type = type;
  if (is_active !== undefined) filter.is_active = is_active === 'true';

  const skip = (Number(page) - 1) * Number(limit);
  const [banners, total] = await Promise.all([
    Banner.find(filter)
      .sort({ display_order: 1, created_at: -1 })
      .skip(skip)
      .limit(Number(limit))
      .select('-__v'),
    Banner.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      banners,
      pagination: {
        total,
        page:  Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    },
  });
});
