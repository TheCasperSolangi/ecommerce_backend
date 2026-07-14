const crypto = require('crypto');
const Rating  = require('../models/ratings');
const Order   = require('../models/Order');
const Product = require('../models/Product');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recalculates and persists ratings_average + ratings_count on the Product.
 * Called after every create / soft-delete.  Best-effort — never throws.
 */
const syncProductRatings = async (productId) => {
  try {
    const agg = await Rating.aggregate([
      { $match: { product_id: productId, is_deleted: false } },
      { $group: { _id: null, avg: { $avg: '$ratings_given' }, count: { $sum: 1 } } },
    ]);
    const avg   = agg[0]?.avg   || 0;
    const count = agg[0]?.count || 0;
    await Product.findByIdAndUpdate(productId, {
      ratings_average: parseFloat(avg.toFixed(2)),
      ratings_count:   count,
    });
  } catch (err) {
    console.error('[syncProductRatings] Failed:', err.message);
  }
};

// ---------------------------------------------------------------------------
// Public — read
// ---------------------------------------------------------------------------

/**
 * GET /api/ratings/:productId
 * Returns all non-deleted reviews for a product, newest first.
 * Query: ?page, ?limit, ?min_rating, ?max_rating
 */
exports.getProductRatings = catchAsync(async (req, res) => {
  const { page = 1, limit = 10, min_rating, max_rating } = req.query;

  const filter = { product_id: req.params.productId, is_deleted: false };
  if (min_rating || max_rating) {
    filter.ratings_given = {};
    if (min_rating) filter.ratings_given.$gte = Number(min_rating);
    if (max_rating) filter.ratings_given.$lte = Number(max_rating);
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [ratings, total] = await Promise.all([
    Rating.find(filter)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(Number(limit))
      .select('-__v -is_deleted -deleted_at'),
    Rating.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      ratings,
      pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
    },
  });
});

// ---------------------------------------------------------------------------
// Customer — create
// ---------------------------------------------------------------------------

/**
 * POST /api/ratings
 *
 * Edge cases enforced:
 *  1. Order must exist, belong to the customer, and be DELIVERED.
 *  2. product_sku must be in the order's cart_details.
 *  3. One review per customer per product per order (DB unique index + pre-check).
 *
 * Body: { product_id, product_sku, order_id, ratings_given, review_body, review_attachments? }
 */
exports.createRating = catchAsync(async (req, res) => {
  const { product_id, product_sku, order_id, ratings_given, review_body, review_attachments } = req.body;

  if (!product_id)    throw new ApiError(400, 'product_id is required');
  if (!product_sku)   throw new ApiError(400, 'product_sku is required');
  if (!order_id)      throw new ApiError(400, 'order_id is required');
  if (!ratings_given) throw new ApiError(400, 'ratings_given is required');
  if (!review_body)   throw new ApiError(400, 'review_body is required');

  // ── EDGE CASE 1: Order must be DELIVERED and belong to the customer ───────
  const order = await Order.findOne({ _id: order_id, user_id: req.user._id });
  if (!order) throw new ApiError(404, 'Order not found');

  if (order.status !== 'DELIVERED') {
    throw new ApiError(403, 'You can only review products from delivered orders');
  }

  // ── EDGE CASE 2: Product SKU must be part of the order ───────────────────
  const orderItems = order.cart_details?.items || [];
  const skuInOrder = orderItems.some(
    (item) => item.product_sku?.toUpperCase() === product_sku.toUpperCase()
  );
  if (!skuInOrder) {
    throw new ApiError(400, 'This product was not part of the specified order');
  }

  // ── EDGE CASE 3: One review per customer per product per order ────────────
  const existing = await Rating.findOne({
    user_id:    req.user._id,
    product_id,
    order_id,
  });
  if (existing) {
    throw new ApiError(409, 'You have already reviewed this product for this order');
  }

  const attachments = Array.isArray(review_attachments) ? review_attachments.slice(0, 3) : [];

  const rating = await Rating.create({
    user_id: req.user._id,
    user_details: {
      first_name:      req.user.first_name,
      last_name:       req.user.last_name,
      profile_picture: req.user.profile_picture || null,
    },
    product_id,
    product_sku: product_sku.toUpperCase(),
    order_id,
    ratings_given: Number(ratings_given),
    review_body,
    review_attachments: attachments,
  });

  // Update the product's aggregate rating.
  syncProductRatings(product_id).catch(() => {});

  res.status(201).json({
    success: true,
    message: 'Review submitted successfully',
    data: { rating },
  });
});

// ---------------------------------------------------------------------------
// Customer — edit own review
// ---------------------------------------------------------------------------

/**
 * PATCH /api/ratings/:id
 *
 * Customers may only edit ratings_given, review_body, review_attachments.
 * Once edited, is_edited is set to true permanently.
 */
exports.updateRating = catchAsync(async (req, res) => {
  const rating = await Rating.findOne({ _id: req.params.id, user_id: req.user._id, is_deleted: false });
  if (!rating) throw new ApiError(404, 'Review not found');

  const { ratings_given, review_body, review_attachments } = req.body;

  let changed = false;

  if (ratings_given !== undefined) {
    rating.ratings_given = Number(ratings_given);
    changed = true;
  }
  if (review_body !== undefined) {
    rating.review_body = review_body;
    changed = true;
  }
  if (Array.isArray(review_attachments)) {
    rating.review_attachments = review_attachments.slice(0, 3);
    changed = true;
  }

  if (!changed) throw new ApiError(400, 'No updatable fields provided');

  // Mark as edited — once true it is never reset.
  rating.is_edited = true;
  await rating.save();

  // Re-sync product averages if the star rating changed.
  if (ratings_given !== undefined) {
    syncProductRatings(rating.product_id).catch(() => {});
  }

  res.status(200).json({
    success: true,
    message: 'Review updated',
    data: { rating },
  });
});

// ---------------------------------------------------------------------------
// Admin — list all reviews + soft delete
// ---------------------------------------------------------------------------

/**
 * GET /api/ratings/admin/all
 * Lists all reviews (including deleted) with filters.
 * Query: ?page, ?limit, ?product_id, ?user_id, ?is_deleted, ?is_edited, ?min_rating
 */
exports.adminGetAllRatings = catchAsync(async (req, res) => {
  const { page = 1, limit = 20, product_id, user_id, is_deleted, is_edited, min_rating } = req.query;

  const filter = {};
  if (product_id)             filter.product_id   = product_id;
  if (user_id)                filter.user_id       = user_id;
  if (is_deleted !== undefined) filter.is_deleted  = is_deleted === 'true';
  if (is_edited  !== undefined) filter.is_edited   = is_edited  === 'true';
  if (min_rating)             filter.ratings_given = { $gte: Number(min_rating) };

  const skip = (Number(page) - 1) * Number(limit);
  const [ratings, total] = await Promise.all([
    Rating.find(filter).sort({ created_at: -1 }).skip(skip).limit(Number(limit)).select('-__v'),
    Rating.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: { ratings, pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) } },
  });
});

/**
 * DELETE /api/ratings/:id  (admin only)
 * Soft-deletes a review. The product's aggregate rating is recalculated.
 */
exports.adminDeleteRating = catchAsync(async (req, res) => {
  const rating = await Rating.findById(req.params.id);
  if (!rating) throw new ApiError(404, 'Review not found');
  if (rating.is_deleted) throw new ApiError(400, 'Review is already deleted');

  rating.is_deleted = true;
  rating.deleted_at = new Date();
  await rating.save();

  syncProductRatings(rating.product_id).catch(() => {});

  res.status(200).json({ success: true, message: 'Review removed successfully' });
});
