const PDFDocument = require('pdfkit');

/**
 * Builds the invoice PDF matching the provided template design:
 *  - Logo placeholder + invoice number  (top)
 *  - Large bold "INVOICE" heading
 *  - Date
 *  - Billed To / From  (two columns)
 *  - Items table  (Item | Quantity | Price | Amount)
 *  - Total row
 *  - Payment method + note
 *  - Two-tone wave decoration  (bottom)
 *
 * @param {object} order          - Mongoose Order document (plain object or Mongoose doc)
 * @param {object} platformSettings - PlatformSetting document (or null)
 * @returns {Promise<Buffer>}     - Resolves with the complete PDF buffer
 */
const generateInvoicePdf = (order, platformSettings) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ── Dimensions ──────────────────────────────────────────────────────
      const W = doc.page.width;   // 595
      const H = doc.page.height;  // 842
      const L = 50;               // left margin
      const R = W - 50;           // right margin

      // ── Colour palette (matches template) ───────────────────────────────
      const DARK  = '#222222';
      const GREY  = '#888888';
      const LIGHT_GREY = '#f0f0f0';
      const WAVE_LIGHT = '#c8c8c8';
      const WAVE_DARK  = '#3a3a3a';

      // ── Helpers ──────────────────────────────────────────────────────────
      const currency = (amount) => {
        const n = parseFloat(amount) || 0;
        return `$${n.toFixed(2)}`;
      };

      const formatDate = (d) => {
        const date = d ? new Date(d) : new Date();
        return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
      };

      // ── Data extraction ──────────────────────────────────────────────────
      const companyName    = platformSettings?.name    || 'Open Commerce';
      const companyTagline = platformSettings?.tagline  || '';
      const invoiceNo      = order.order_code || 'N/A';
      const orderDate      = formatDate(order.created_at);
      const paymentMethod  = (order.payment_method || '').replace(/_/g, ' ');
      const items          = order.cart_details?.items || [];
      const subtotal       = order.cart_details?.subtotal || 0;
      const shipping       = order.cart_details?.shipping_charges || 0;
      const discount       = order.cart_details?.coupon_discount || 0;

      const billedTo = order.user_details || {};
      const address  = billedTo.address || {};

      // ── TOP SECTION: Logo + Invoice number ──────────────────────────────
      let y = L; // current Y cursor

      // Logo area (placeholder box)
      doc.rect(L, y, 80, 35).fillAndStroke(LIGHT_GREY, LIGHT_GREY);
      doc.fillColor(GREY).fontSize(9).font('Helvetica')
         .text('YOUR', L + 6, y + 8)
         .text('LOGO',  L + 6, y + 19);

      // Invoice number — top right
      doc.fillColor(DARK).fontSize(9).font('Helvetica')
         .text(`NO. ${invoiceNo}`, 0, y + 12, { align: 'right', width: W - 50 });

      y += 55;

      // ── INVOICE heading ──────────────────────────────────────────────────
      doc.fillColor(DARK).fontSize(46).font('Helvetica-Bold')
         .text('INVOICE', L, y);
      y += 60;

      // ── Date ─────────────────────────────────────────────────────────────
      doc.fontSize(11).font('Helvetica-Bold').fillColor(DARK)
         .text('Date:', L, y, { continued: true })
         .font('Helvetica').text(`  ${orderDate}`);
      y += 28;

      // ── Billed To / From ─────────────────────────────────────────────────
      const col2X = W / 2 + 10;
      const billedName = [billedTo.first_name, billedTo.last_name].filter(Boolean).join(' ') || 'Customer';
      const billedAddr = [address.street_address, address.city].filter(Boolean).join(', ') || '';
      const billedEmail = billedTo.email || '';

      // "Billed to:" header
      doc.fontSize(11).font('Helvetica-Bold').fillColor(DARK)
         .text('Billed to:', L, y);
      // "From:" header
      doc.fontSize(11).font('Helvetica-Bold').fillColor(DARK)
         .text('From:', col2X, y);

      y += 16;

      // Billed-to details
      doc.fontSize(10).font('Helvetica').fillColor(DARK)
         .text(billedName,  L,      y)
         .text(billedAddr,  L,      y + 14, { width: col2X - L - 10 })
         .text(billedEmail, L,      y + 28, { width: col2X - L - 10 });

      // From details
      doc.fontSize(10).font('Helvetica').fillColor(DARK)
         .text(companyName,    col2X, y)
         .text(companyTagline, col2X, y + 14, { width: R - col2X })
         .text('support@yourstore.com', col2X, y + 28, { width: R - col2X });

      y += 56;

      // ── Items table ───────────────────────────────────────────────────────
      const COL = {
        item:   L,
        qty:    L + 270,
        price:  L + 350,
        amount: L + 430,
      };
      const ROW_H = 24;

      // Header row — light grey background
      doc.rect(L, y, R - L, ROW_H).fill(LIGHT_GREY);
      doc.fillColor(DARK).fontSize(10).font('Helvetica')
         .text('Item',     COL.item   + 6, y + 7)
         .text('Quantity', COL.qty,         y + 7)
         .text('Price',    COL.price,        y + 7)
         .text('Amount',   COL.amount,       y + 7);
      y += ROW_H;

      // Item rows — prefer product_name; fall back to SKU
      const tableItems = items.length > 0
        ? items
        : [{ product_name: 'N/A', product_sku: 'N/A', quantity: 1, price: subtotal }];

      tableItems.forEach((item, i) => {
        const rowY = y + i * ROW_H;
        const amount = (parseFloat(item.price) || 0) * (parseInt(item.quantity) || 1);
        const label =
          (item.product_name && String(item.product_name).trim()) ||
          item.product_sku ||
          'Item';

        // Subtle alternating row tint
        if (i % 2 === 0) {
          doc.rect(L, rowY, R - L, ROW_H).fill('#fafafa');
        }

        doc.fillColor(DARK).fontSize(10).font('Helvetica')
           .text(label, COL.item + 6, rowY + 7, { width: COL.qty - COL.item - 12 })
           .text(String(item.quantity || 1),         COL.qty,         rowY + 7)
           .text(currency(item.price),               COL.price,        rowY + 7)
           .text(currency(amount),                   COL.amount,       rowY + 7);
      });

      y += tableItems.length * ROW_H;

      // Divider line
      doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(DARK).stroke();
      y += 10;

      // Discount row (if applicable)
      if (discount > 0) {
        doc.fontSize(10).font('Helvetica').fillColor(GREY)
           .text('Coupon Discount', COL.price - 80, y, { width: 150 })
           .fillColor(DARK)
           .text(`-${currency(discount)}`, COL.amount, y);
        y += ROW_H;
      }

      // Shipping row (if applicable)
      if (shipping > 0) {
        doc.fontSize(10).font('Helvetica').fillColor(GREY)
           .text('Shipping', COL.price - 80, y, { width: 150 })
           .fillColor(DARK)
           .text(currency(shipping), COL.amount, y);
        y += ROW_H;
      }

      // Total row
      doc.fontSize(11).font('Helvetica-Bold').fillColor(DARK)
         .text('Total', COL.price - 80, y, { width: 150 })
         .text(currency(subtotal), COL.amount, y);

      y += 32;

      // Divider
      doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(DARK).stroke();
      y += 20;

      // ── Payment method + Note ────────────────────────────────────────────
      doc.fontSize(11).font('Helvetica-Bold').fillColor(DARK)
         .text('Payment method:', L, y, { continued: true })
         .font('Helvetica').text(`  ${paymentMethod}`);
      y += 18;

      doc.fontSize(11).font('Helvetica-Bold').fillColor(DARK)
         .text('Note:', L, y, { continued: true })
         .font('Helvetica').text('  Thank you for choosing us!');

      // ── Wave decoration (bottom) ─────────────────────────────────────────
      // Light wave (left / back layer)
      doc.save();
      doc.moveTo(0, H - 130)
         .bezierCurveTo(W * 0.3, H - 60,  W * 0.5, H - 170, W * 0.75, H - 100)
         .bezierCurveTo(W * 0.85, H - 70, W * 0.92, H - 50,  W,        H - 80)
         .lineTo(W, H)
         .lineTo(0, H)
         .closePath()
         .fill(WAVE_LIGHT);

      // Dark wave (right / front layer)
      doc.moveTo(W * 0.45, H - 10)
         .bezierCurveTo(W * 0.6, H - 100, W * 0.75, H - 60, W, H - 30)
         .lineTo(W, H)
         .lineTo(W * 0.45, H)
         .closePath()
         .fill(WAVE_DARK);
      doc.restore();

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};

module.exports = generateInvoicePdf;
