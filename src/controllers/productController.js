const Product = require('../models/Products');
const Category = require('../models/Category');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BLOCKED_FIELDS = [
  'slug',
  'min_price', 'max_price', 'total_stock',
  'ratings_average', 'ratings_count',
  'published_at',
  'is_deleted', 'deleted_at',
  'created_by', 'updated_by',
  'warehouse_id',  // stamped automatically from the authenticated admin's warehouse
];

const pickAllowed = (body, extras = []) => {
  const blocked = [...BLOCKED_FIELDS, ...extras];
  const result = {};
  Object.keys(body).forEach((key) => {
    if (!blocked.includes(key)) result[key] = body[key];
  });
  return result;
};

const resolveSort = (sort) => {
  const map = {
    price_asc: { min_price: 1 },
    price_desc: { min_price: -1 },
    newest: { created_at: -1 },
    oldest: { created_at: 1 },
    rating: { ratings_average: -1 },
    featured: { is_featured: -1, created_at: -1 },
  };
  return map[sort] || { created_at: -1 };
};

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

exports.getAllProducts = catchAsync(async (req, res) => {
  const {
    page = 1, limit = 24, sort = 'newest',
    search, category, brand, min_price, max_price, min_rating, featured, status,
    attr_key, attr_value,
  } = req.query;

  const isAdmin = req.user && req.user.user_role === 'admin';

  const filter = { status: status && isAdmin ? status : 'active' };

  // ── Warehouse scope ──────────────────────────────────────────────────────
  // Admin reads: apply warehouse filter from the middleware.
  // Public (unauthenticated / customer) reads: no warehouse filter — products
  // are visible across all warehouses on the storefront.
  if (isAdmin && req.warehouseFilter) {
    Object.assign(filter, req.warehouseFilter);
  }

  if (search) filter.$text = { $search: search };
  if (brand) filter.brand = brand;
  if (featured !== undefined) filter.is_featured = featured === 'true';

  if (category) {
    const descendants = await Category.findDescendants(category).select('_id');
    const categoryIds = [category, ...descendants.map((d) => String(d._id))];
    filter.categories = { $in: categoryIds };
  }

  if (min_price || max_price) {
    filter.min_price = {};
    if (min_price) filter.min_price.$gte = Number(min_price);
    if (max_price) filter.min_price.$lte = Number(max_price);
  }

  if (min_rating !== undefined && min_rating !== '') {
    filter.ratings_average = { $gte: Number(min_rating) };
  }

  // Variant / product attribute filter — e.g. attr_key=Color&attr_value=Red
  if (attr_key && attr_value) {
    const key = String(attr_key);
    const value = String(attr_value);
    filter.$or = [
      { [`attributes.${key}`]: value },
      { variants: { $elemMatch: { [`attributes.${key}`]: value, is_active: true } } },
    ];
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort(resolveSort(sort))
      .skip(skip)
      .limit(Number(limit))
      .populate('brand', 'name slug logo')
      .populate('categories', 'name slug')
      .populate('warehouse_id', 'name warehouse_code city')
      .select('-__v -variants.cost_price'),
    Product.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      products,
      pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
    },
  });
});

exports.getProduct = catchAsync(async (req, res) => {
  const { idOrSlug } = req.params;
  const isId = idOrSlug.match(/^[a-f\d]{24}$/i);

  const query = isId
    ? Product.findById(idOrSlug)
    : Product.findOne({ slug: idOrSlug });

  const product = await query
    .populate('brand', 'name slug logo social_links')
    .populate('categories', 'name slug ancestors')
    .populate('created_by', 'first_name last_name')
    .populate('warehouse_id', 'name warehouse_code city state')
    .select('-__v -variants.cost_price');

  if (!product) throw new ApiError(404, 'Product not found');

  const isAdmin = req.user && req.user.user_role === 'admin';
  if (product.status !== 'active' && !isAdmin) throw new ApiError(404, 'Product not found');

  // Admin: enforce warehouse scope — cannot view products outside their warehouse.
  if (isAdmin && req.warehouseId) {
    if (String(product.warehouse_id?._id || product.warehouse_id) !== String(req.warehouseId)) {
      throw new ApiError(404, 'Product not found');
    }
  }

  res.status(200).json({ success: true, data: { product } });
});

// ---------------------------------------------------------------------------
// Admin — create / update / delete
// ---------------------------------------------------------------------------

exports.createProduct = catchAsync(async (req, res) => {
  const data = pickAllowed(req.body);
  data.created_by = req.user._id;
  // Stamp the creating admin's warehouse onto the product.
  data.warehouse_id = req.warehouseId;

  const product = new Product(data);
  await product.save();

  res.status(201).json({
    success: true,
    message: 'Product created successfully',
    data: { product },
  });
});

exports.updateProduct = catchAsync(async (req, res) => {
  const data = pickAllowed(req.body);
  data.updated_by = req.user._id;

  // Scope the find to the admin's warehouse so they can't edit another warehouse's product.
  const filter = { _id: req.params.id, ...req.warehouseFilter };
  const product = await Product.findOne(filter);
  if (!product) throw new ApiError(404, 'Product not found');

  Object.assign(product, data);
  await product.save();

  res.status(200).json({ success: true, message: 'Product updated successfully', data: { product } });
});

exports.deleteProduct = catchAsync(async (req, res) => {
  const filter = { _id: req.params.id, ...req.warehouseFilter };
  const product = await Product.findOne(filter);
  if (!product) throw new ApiError(404, 'Product not found');

  await product.softDelete();
  res.status(200).json({ success: true, message: 'Product deleted successfully' });
});

// ---------------------------------------------------------------------------
// Variant management
// ---------------------------------------------------------------------------

exports.addVariant = catchAsync(async (req, res) => {
  const filter = { _id: req.params.id, ...req.warehouseFilter };
  const product = await Product.findOne(filter);
  if (!product) throw new ApiError(404, 'Product not found');

  product.variants.push(req.body);
  product.updated_by = req.user._id;
  await product.save();

  const newVariant = product.variants[product.variants.length - 1];
  res.status(201).json({ success: true, message: 'Variant added successfully', data: { variant: newVariant } });
});

exports.updateVariant = catchAsync(async (req, res) => {
  const filter = { _id: req.params.id, ...req.warehouseFilter };
  const product = await Product.findOne(filter);
  if (!product) throw new ApiError(404, 'Product not found');

  const variant = product.variants.id(req.params.variantId);
  if (!variant) throw new ApiError(404, 'Variant not found');

  const { cost_price, ...safeData } = req.body;
  Object.assign(variant, safeData);
  product.updated_by = req.user._id;
  await product.save();

  res.status(200).json({ success: true, message: 'Variant updated successfully', data: { variant } });
});

exports.deleteVariant = catchAsync(async (req, res) => {
  const filter = { _id: req.params.id, ...req.warehouseFilter };
  const product = await Product.findOne(filter);
  if (!product) throw new ApiError(404, 'Product not found');

  const variant = product.variants.id(req.params.variantId);
  if (!variant) throw new ApiError(404, 'Variant not found');

  if (product.variants.length === 1) {
    throw new ApiError(400, 'A product must have at least one variant. Add another before deleting this one.');
  }

  variant.deleteOne();
  product.updated_by = req.user._id;
  await product.save();

  res.status(200).json({ success: true, message: 'Variant deleted successfully' });
});

// ---------------------------------------------------------------------------
// Stock management
// ---------------------------------------------------------------------------

exports.updateStock = catchAsync(async (req, res) => {
  const { quantity, operation = 'set' } = req.body;

  if (typeof quantity !== 'number' || quantity < 0) {
    throw new ApiError(400, 'quantity must be a non-negative number');
  }

  const filter = { _id: req.params.id, ...req.warehouseFilter };
  const product = await Product.findOne(filter);
  if (!product) throw new ApiError(404, 'Product not found');

  const variant = product.variants.id(req.params.variantId);
  if (!variant) throw new ApiError(404, 'Variant not found');

  if (operation === 'set') {
    variant.stock_quantity = quantity;
  } else if (operation === 'increment') {
    variant.stock_quantity += quantity;
  } else if (operation === 'decrement') {
    if (variant.stock_quantity < quantity) throw new ApiError(400, 'Insufficient stock');
    variant.stock_quantity -= quantity;
  } else {
    throw new ApiError(400, "operation must be 'set', 'increment', or 'decrement'");
  }

  product.updated_by = req.user._id;
  await product.save();

  res.status(200).json({
    success: true,
    message: 'Stock updated successfully',
    data: { stock_quantity: variant.stock_quantity },
  });
});



/**
 * GET /api/products/new-arrivals
 * Fetch the latest products based on created_at date
 * Query params: limit (default 10, max 50)
 */
exports.getNewArrivals = catchAsync(async (req, res) => {
  const { limit = 10 } = req.query;
  const limitNum = Math.min(parseInt(limit) || 10, 50);

  const filter = { status: 'active' };

  // Apply warehouse filter for admin users
  if (req.user && req.user.user_role === 'admin' && req.warehouseFilter) {
    Object.assign(filter, req.warehouseFilter);
  }

  const products = await Product.find(filter)
    .sort({ created_at: -1 })
    .limit(limitNum)
    .populate('brand', 'name slug logo')
    .populate('categories', 'name slug')
    .populate('warehouse_id', 'name warehouse_code city')
    .select('-__v -variants.cost_price');

  res.status(200).json({
    success: true,
    data: { products },
    meta: { count: products.length, limit: limitNum },
  });
});

/**
 * GET /api/products/best-sellers
 * Fetch top-selling products based on order history
 * Query params: limit (default 10, max 50), days (default 30)
 */
exports.getBestSellers = catchAsync(async (req, res) => {
  const { limit = 10, days = 30 } = req.query;
  const limitNum = Math.min(parseInt(limit) || 10, 50);
  const daysNum = parseInt(days) || 30;

  // Import Orders model
  const Orders = require('../models/Order');

  // Calculate date range
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysNum);

  // Build warehouse filter for admin users
  let warehouseFilter = {};
  if (req.user && req.user.user_role === 'admin' && req.warehouseFilter) {
    warehouseFilter = req.warehouseFilter;
  }

  // Aggregation pipeline to find best-selling products
  const bestSellers = await Orders.aggregate([
    // Match delivered orders within date range
    {
      $match: {
        status: 'DELIVERED',
        created_at: { $gte: startDate },
        ...warehouseFilter,
      },
    },
    // Unwind cart_details.items to get individual products
    { $unwind: '$cart_details.items' },
    // Group by product ID and calculate total quantity sold
    {
      $group: {
        _id: '$cart_details.items.product_id',
        total_sold: { $sum: '$cart_details.items.quantity' },
        total_revenue: { $sum: { $multiply: ['$cart_details.items.price', '$cart_details.items.quantity'] } },
        last_order_date: { $max: '$created_at' },
        order_count: { $sum: 1 },
      },
    },
    // Sort by total sold descending
    { $sort: { total_sold: -1 } },
    // Limit results
    { $limit: limitNum },
  ]);

  // Extract product IDs
  const productIds = bestSellers.map((item) => item._id);

  // Fetch product details
  const productFilter = {
    _id: { $in: productIds },
    status: 'active',
  };

  // Apply warehouse filter for admin users
  if (req.user && req.user.user_role === 'admin' && req.warehouseFilter) {
    Object.assign(productFilter, req.warehouseFilter);
  }

  const products = await Product.find(productFilter)
    .populate('brand', 'name slug logo')
    .populate('categories', 'name slug')
    .populate('warehouse_id', 'name warehouse_code city')
    .select('-__v -variants.cost_price');

  // Merge sales data with product details and maintain order
  const productsWithSales = bestSellers.map((salesData) => {
    const product = products.find((p) => String(p._id) === String(salesData._id));
    return {
      ...product.toObject(),
      sales_metrics: {
        total_sold: salesData.total_sold,
        total_revenue: salesData.total_revenue,
        order_count: salesData.order_count,
        last_order_date: salesData.last_order_date,
      },
    };
  });

  res.status(200).json({
    success: true,
    data: { products: productsWithSales },
    meta: {
      count: productsWithSales.length,
      limit: limitNum,
      days_analyzed: daysNum,
    },
  });
});

/**
 * GET /api/products/featured
 * Fetch featured products
 * Query params: limit (default 10, max 50)
 */
exports.getFeatured = catchAsync(async (req, res) => {
  const { limit = 10 } = req.query;
  const limitNum = Math.min(parseInt(limit) || 10, 50);

  const filter = {
    status: 'active',
    is_featured: true,
  };

  // Apply warehouse filter for admin users
  if (req.user && req.user.user_role === 'admin' && req.warehouseFilter) {
    Object.assign(filter, req.warehouseFilter);
  }

  const products = await Product.find(filter)
    .sort({ created_at: -1 })
    .limit(limitNum)
    .populate('brand', 'name slug logo')
    .populate('categories', 'name slug')
    .populate('warehouse_id', 'name warehouse_code city')
    .select('-__v -variants.cost_price');

  res.status(200).json({
    success: true,
    data: { products },
    meta: { count: products.length, limit: limitNum },
  });
});