const Order = require('../models/Order');
const PlatformSettings = require('../models/platformSettings');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const generateInvoicePdf = require('../utils/generateInvoicePdf');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the order and verifies access.
 * - Customers: can only access their own orders.
 * - Admins:    can access any order.
 */
const resolveOrder = async (orderId, user) => {
  const filter = { _id: orderId };
  if (user.user_role !== 'admin') filter.user_id = user._id;

  const order = await Order.findOne(filter);
  if (!order) throw new ApiError(404, 'Order not found');
  return order;
};

// ---------------------------------------------------------------------------
// Download — streams the PDF as a file attachment
// ---------------------------------------------------------------------------

/**
 * GET /api/invoices/:orderId/download
 *
 * Responds with the PDF as a downloadable attachment.
 * Browser will save it as  invoice-ORD-xxx.pdf
 */
exports.downloadInvoice = catchAsync(async (req, res) => {
  const order    = await resolveOrder(req.params.orderId, req.user);
  const settings = await PlatformSettings.findOne();

  const pdfBuffer = await generateInvoicePdf(order.toObject(), settings?.toObject());

  const filename = `invoice-${order.order_code}.pdf`;

  res.set({
    'Content-Type':        'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length':      pdfBuffer.length,
  });

  res.send(pdfBuffer);
});

// ---------------------------------------------------------------------------
// Print — streams the PDF inline so the browser opens its print dialog
// ---------------------------------------------------------------------------

/**
 * GET /api/invoices/:orderId/print
 *
 * Responds with the PDF inline (Content-Disposition: inline).
 * The browser renders it and the frontend should call window.print()
 * after the iframe/embed loads, or open it in a new tab and trigger
 * the browser's native print dialog.
 */
exports.printInvoice = catchAsync(async (req, res) => {
  const order    = await resolveOrder(req.params.orderId, req.user);
  const settings = await PlatformSettings.findOne();

  const pdfBuffer = await generateInvoicePdf(order.toObject(), settings?.toObject());

  res.set({
    'Content-Type':        'application/pdf',
    'Content-Disposition': 'inline',
    'Content-Length':      pdfBuffer.length,
  });

  res.send(pdfBuffer);
});
