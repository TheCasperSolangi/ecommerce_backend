const crypto = require('crypto');
const Transaction = require('../models/Transactions');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const generateTransactionCode = () =>
  `TXN-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

/**
 * Creates an order-income transaction record.
 * Called from orderController after a successful order placement.
 * Fire-and-forget safe — caller wraps in .catch(() => {}).
 *
 * @param {object} order - Saved Mongoose Order document
 */
const createOrderTransaction = async (order) => {
  await Transaction.create({
    transaction_code:    generateTransactionCode(),
    transaction_title:   `Order payment — ${order.order_code}`,
    type:                'INCOME',
    amount:              order.cart_details?.subtotal || 0,
    currency:            process.env.DEFAULT_CURRENCY?.toUpperCase() || 'USD',
    is_order_transaction: true,
    order_code:          order.order_code,
    is_refund:           false,
    is_vendor:           false,
    created_by:          order.user_id,
  });
};

// Export so orderController can import it without a circular dependency.
exports.createOrderTransaction = createOrderTransaction;

// ---------------------------------------------------------------------------
// Admin — create manual income / expense transaction
// ---------------------------------------------------------------------------

/**
 * POST /api/transactions
 *
 * Only admin. Used for manual bookkeeping entries such as vendor payments,
 * operational expenses, or ad-hoc income entries.
 *
 * Body: {
 *   transaction_title,
 *   type: 'INCOME' | 'EXPENSE',
 *   amount,
 *   currency?,
 *   is_vendor?,
 *   vendor_code?,
 *   is_refund?,
 *   order_code?,
 *   notes?
 * }
 */
exports.createTransaction = catchAsync(async (req, res) => {
  const {
    transaction_title,
    type,
    amount,
    currency,
    is_vendor,
    vendor_code,
    is_refund,
    order_code,
    notes,
  } = req.body;

  if (!transaction_title) throw new ApiError(400, 'transaction_title is required');
  if (!type)              throw new ApiError(400, 'type is required');
  if (!['INCOME', 'EXPENSE'].includes(type)) {
    throw new ApiError(400, 'type must be INCOME or EXPENSE');
  }
  if (amount === undefined || amount === null) throw new ApiError(400, 'amount is required');
  if (isNaN(parseFloat(amount)) || parseFloat(amount) < 0) {
    throw new ApiError(400, 'amount must be a non-negative number');
  }

  const transaction = await Transaction.create({
    transaction_code:     generateTransactionCode(),
    transaction_title,
    type,
    amount:               parseFloat(amount),
    currency:             (currency || process.env.DEFAULT_CURRENCY || 'USD').toUpperCase(),
    is_vendor:            Boolean(is_vendor),
    vendor_code:          vendor_code || null,
    is_refund:            Boolean(is_refund),
    is_order_transaction: false,
    order_code:           order_code || null,
    notes:                notes || '',
    created_by:           req.user._id,
  });

  res.status(201).json({
    success: true,
    message: 'Transaction recorded successfully',
    data: { transaction },
  });
});

// ---------------------------------------------------------------------------
// Admin — read
// ---------------------------------------------------------------------------

/**
 * GET /api/transactions
 *
 * Query params:
 *   page, limit, type (INCOME|EXPENSE), from, to,
 *   is_order_transaction, is_refund, is_vendor, order_code
 */
exports.getAllTransactions = catchAsync(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    type,
    from,
    to,
    is_order_transaction,
    is_refund,
    is_vendor,
    order_code,
  } = req.query;

  const filter = {};
  if (type)       filter.type       = type;
  if (order_code) filter.order_code = order_code;

  if (is_order_transaction !== undefined)
    filter.is_order_transaction = is_order_transaction === 'true';
  if (is_refund !== undefined)
    filter.is_refund = is_refund === 'true';
  if (is_vendor !== undefined)
    filter.is_vendor = is_vendor === 'true';

  if (from || to) {
    filter.created_at = {};
    if (from) filter.created_at.$gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      filter.created_at.$lte = end;
    }
  }

  const skip = (Number(page) - 1) * Number(limit);

  const [transactions, total] = await Promise.all([
    Transaction.find(filter)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(Number(limit))
      .select('-__v'),
    Transaction.countDocuments(filter),
  ]);

  // ── Summary totals for the current filter ────────────────────────────────
  const summaryPipeline = await Transaction.aggregate([
    { $match: filter },
    {
      $group: {
        _id:          '$type',
        total_amount: { $sum: '$amount' },
        count:        { $sum: 1 },
      },
    },
  ]);

  const summary = { INCOME: 0, EXPENSE: 0, net: 0 };
  summaryPipeline.forEach(({ _id, total_amount }) => {
    summary[_id] = parseFloat(total_amount.toFixed(2));
  });
  summary.net = parseFloat((summary.INCOME - summary.EXPENSE).toFixed(2));

  res.status(200).json({
    success: true,
    data: {
      transactions,
      summary,
      pagination: {
        total,
        page:  Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    },
  });
});

/** GET /api/transactions/:id */
exports.getTransaction = catchAsync(async (req, res) => {
  const transaction = await Transaction.findById(req.params.id).select('-__v');
  if (!transaction) throw new ApiError(404, 'Transaction not found');
  res.status(200).json({ success: true, data: { transaction } });
});

// ---------------------------------------------------------------------------
// Admin — update  (limited fields only — financial records are immutable)
// ---------------------------------------------------------------------------

/**
 * PATCH /api/transactions/:id
 *
 * Only non-financial metadata may be edited: transaction_title and notes.
 * Amount, type, order_code, and all flags are permanently locked after creation
 * to preserve the integrity of the financial ledger.
 */
exports.updateTransaction = catchAsync(async (req, res) => {
  const { transaction_title, notes } = req.body;

  const transaction = await Transaction.findById(req.params.id);
  if (!transaction) throw new ApiError(404, 'Transaction not found');

  if (transaction_title !== undefined) transaction.transaction_title = transaction_title;
  if (notes !== undefined)             transaction.notes             = notes;

  await transaction.save();

  res.status(200).json({
    success: true,
    message: 'Transaction updated successfully',
    data: { transaction },
  });
});

// ---------------------------------------------------------------------------
// DELETE is intentionally NOT implemented.
// Financial records must never be deleted — they form an immutable audit trail.
// If a reversal is needed, create a counter-entry transaction instead.
// ---------------------------------------------------------------------------
