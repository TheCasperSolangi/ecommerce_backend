const PlatformSettings = require('../models/platformSettings');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fields that must never be set directly through the API.
 * Timestamps are managed by Mongoose automatically.
 */
const BLOCKED_FIELDS = ['_id', '__v', 'created_at', 'updated_at'];

const pickAllowed = (body) => {
  const result = {};
  Object.keys(body).forEach((key) => {
    if (!BLOCKED_FIELDS.includes(key)) result[key] = body[key];
  });
  return result;
};

// ---------------------------------------------------------------------------
// Platform settings is a SINGLETON document.
// There is exactly one settings record in the collection at all times.
// ---------------------------------------------------------------------------

/**
 * GET /api/settings
 * Public — the frontend needs name, tagline, social links, policy URLs etc.
 * to render the storefront shell without authentication.
 */
exports.getSettings = catchAsync(async (req, res) => {
  const settings = await PlatformSettings.findOne().select('-__v');

  if (!settings) {
    throw new ApiError(404, 'Platform settings have not been configured yet');
  }

  res.status(200).json({ success: true, data: { settings } });
});

/**
 * POST /api/settings
 * Admin only — initialises the singleton settings document.
 * Returns 409 if settings already exist (use PATCH to update).
 */
exports.createSettings = catchAsync(async (req, res) => {
  const existing = await PlatformSettings.findOne();
  if (existing) {
    throw new ApiError(
      409,
      'Platform settings already exist. Use PATCH /api/settings to update them.'
    );
  }

  const data = pickAllowed(req.body);
  const settings = await PlatformSettings.create(data);

  res.status(201).json({
    success: true,
    message: 'Platform settings created successfully',
    data: { settings },
  });
});

/**
 * PATCH /api/settings
 * Admin only — partial update of the singleton settings document.
 * Deep-merges social_links so callers can update a single social key
 * without wiping the others.
 */
exports.updateSettings = catchAsync(async (req, res) => {
  const settings = await PlatformSettings.findOne();
  if (!settings) {
    throw new ApiError(
      404,
      'Platform settings do not exist yet. Use POST /api/settings to create them first.'
    );
  }

  const data = pickAllowed(req.body);

  // Deep-merge social_links — if the caller only passes { facebook: '...' }
  // we should not null-out instagram, youtube, etc.
  if (data.social_links && typeof data.social_links === 'object') {
    data.social_links = {
      ...((settings.social_links || {}).toObject
        ? settings.social_links.toObject()
        : settings.social_links || {}),
      ...data.social_links,
    };
  }

  Object.assign(settings, data);
  await settings.save();

  res.status(200).json({
    success: true,
    message: 'Platform settings updated successfully',
    data: { settings },
  });
});
