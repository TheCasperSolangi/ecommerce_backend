const crypto = require('crypto');
const Ticket = require('../models/ticket');
const Order  = require('../models/Order');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const sendEmail = require('../utils/sendEmail');
const { sendPushToMany } = require('../utils/pushNotification');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUPPORT_ROLES = ['admin', 'customer_support'];

// Statuses that only support/admin staff may set.
const STAFF_ONLY_STATUSES = ['CLOSED', 'UNDER_REVIEW'];

const generateTicketCode = () =>
  `TKT-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sends a status-change notification via email + push to the ticket owner.
 * Fire-and-forget — never throws.
 */
const notifyTicketUpdate = async (ticket, userEmail, userName, pushTokens = []) => {
  const statusLabel = ticket.status.replace(/_/g, ' ');

  // ── Email ─────────────────────────────────────────────────────────────────
  try {
    await sendEmail({
      to:      userEmail,
      subject: `Your ticket ${ticket.ticket_code} — ${statusLabel}`,
      html: `<p>Hi ${userName},</p>
             <p>Your support ticket <strong>${ticket.ticket_code}</strong> has been updated.</p>
             <p><strong>Status:</strong> ${statusLabel}</p>
             ${ticket.notes_by_team ? `<p><strong>Team note:</strong> ${ticket.notes_by_team}</p>` : ''}
             <p>Thank you for your patience.</p>`,
    });
  } catch (err) {
    console.error(`[Ticket notify] Email failed for ${ticket.ticket_code}:`, err.message);
  }

  // ── Push notifications ────────────────────────────────────────────────────
  const tokens = (pushTokens || []).map((t) => t.token).filter(Boolean);
  if (tokens.length > 0) {
    try {
      await sendPushToMany(
        tokens,
        `Ticket Update — ${statusLabel} 🎫`,
        ticket.notes_by_team
          ? `${ticket.ticket_code}: ${ticket.notes_by_team}`
          : `Your ticket ${ticket.ticket_code} status is now ${statusLabel}.`,
        {
          ticket_id:   String(ticket._id),
          ticket_code: ticket.ticket_code,
          status:      ticket.status,
        }
      );
    } catch (err) {
      console.error(`[Ticket notify] Push failed for ${ticket.ticket_code}:`, err.message);
    }
  }
};

// ---------------------------------------------------------------------------
// Customer — create
// ---------------------------------------------------------------------------

/**
 * POST /api/tickets
 *
 * Any authenticated user can raise a ticket.
 * Status is always forced to OPEN — customers cannot choose a status.
 * notes_by_team is always empty on creation.
 *
 * Body: { order_code, ticket_type, ticket_description?, attachments? }
 */
exports.createTicket = catchAsync(async (req, res) => {
  const { order_code, ticket_type, ticket_description, attachments } = req.body;

  if (!order_code)   throw new ApiError(400, 'order_code is required');
  if (!ticket_type)  throw new ApiError(400, 'ticket_type is required');

  // Verify the order belongs to this customer.
  const order = await Order.findOne({
    order_code,
    user_id: req.user._id,
  }).select('order_code status');

  if (!order) {
    throw new ApiError(404, 'No order found with that code on your account');
  }

  const ticket = await Ticket.create({
    ticket_code:        generateTicketCode(),
    customer_id:        String(req.user._id),
    order_code,
    ticket_type,
    ticket_description: ticket_description || '',
    attachments:        Array.isArray(attachments) ? attachments : [],
    status:             'OPEN',          // always OPEN on creation
    notes_by_team:      '',              // staff fills this in later
  });

  res.status(201).json({
    success: true,
    message: 'Ticket raised successfully. Our team will review it shortly.',
    data: { ticket },
  });
});

// ---------------------------------------------------------------------------
// Customer — view own tickets
// ---------------------------------------------------------------------------

/** GET /api/tickets — own tickets, newest first */
exports.getMyTickets = catchAsync(async (req, res) => {
  const { page = 1, limit = 10, status } = req.query;

  const filter = { customer_id: String(req.user._id) };
  if (status) filter.status = status;

  const skip = (Number(page) - 1) * Number(limit);
  const [tickets, total] = await Promise.all([
    Ticket.find(filter).sort({ created_at: -1 }).skip(skip).limit(Number(limit)),
    Ticket.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      tickets,
      pagination: {
        total,
        page:  Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    },
  });
});

/** GET /api/tickets/:id — single own ticket */
exports.getTicket = catchAsync(async (req, res) => {
  const ticket = await Ticket.findOne({
    _id:         req.params.id,
    customer_id: String(req.user._id),
  });
  if (!ticket) throw new ApiError(404, 'Ticket not found');

  res.status(200).json({ success: true, data: { ticket } });
});

// ---------------------------------------------------------------------------
// Customer — update (description / attachments only, while OPEN)
// ---------------------------------------------------------------------------

/**
 * PATCH /api/tickets/:id
 *
 * Customers may only edit ticket_description and attachments.
 * Only allowed while the ticket is still OPEN.
 * Status and notes_by_team are never writable by the customer.
 */
exports.updateTicket = catchAsync(async (req, res) => {
  const ticket = await Ticket.findOne({
    _id:         req.params.id,
    customer_id: String(req.user._id),
  });
  if (!ticket) throw new ApiError(404, 'Ticket not found');

  if (ticket.status !== 'OPEN') {
    throw new ApiError(
      403,
      `Ticket cannot be edited because it is already ${ticket.status.replace(/_/g, ' ').toLowerCase()}. Please contact support for further assistance.`
    );
  }

  // Silently whitelist — ignore status, notes_by_team, ticket_code, customer_id, order_code.
  if (req.body.ticket_description !== undefined) {
    ticket.ticket_description = req.body.ticket_description;
  }
  if (Array.isArray(req.body.attachments)) {
    ticket.attachments = req.body.attachments;
  }

  await ticket.save();

  res.status(200).json({
    success: true,
    message: 'Ticket updated successfully',
    data: { ticket },
  });
});

// ---------------------------------------------------------------------------
// Staff (admin / customer_support) — manage all tickets
// ---------------------------------------------------------------------------

/** GET /api/tickets/staff/all — all tickets with filters */
exports.staffGetAllTickets = catchAsync(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    status,
    ticket_type,
    customer_id,
    order_code,
    from,
    to,
  } = req.query;

  const filter = {};
  if (status)      filter.status      = status;
  if (ticket_type) filter.ticket_type = ticket_type;
  if (customer_id) filter.customer_id = customer_id;
  if (order_code)  filter.order_code  = order_code;

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
  const [tickets, total] = await Promise.all([
    Ticket.find(filter).sort({ created_at: -1 }).skip(skip).limit(Number(limit)),
    Ticket.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      tickets,
      pagination: {
        total,
        page:  Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    },
  });
});

/** GET /api/tickets/staff/:id — single ticket (any customer) */
exports.staffGetTicket = catchAsync(async (req, res) => {
  const ticket = await Ticket.findById(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found');
  res.status(200).json({ success: true, data: { ticket } });
});

/**
 * PATCH /api/tickets/staff/:id
 *
 * Staff can update:
 *   - status       → OPEN | UNDER_REVIEW | CLOSED
 *   - notes_by_team
 *
 * Customers cannot reach this endpoint (route protected by authorize middleware).
 */
exports.staffUpdateTicket = catchAsync(async (req, res) => {
  const { status, notes_by_team } = req.body;

  const ticket = await Ticket.findById(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found');

  // Validate status transition if provided.
  if (status !== undefined) {
    const VALID_STATUSES = ['OPEN', 'UNDER_REVIEW', 'CLOSED'];
    if (!VALID_STATUSES.includes(status)) {
      throw new ApiError(400, `status must be one of: ${VALID_STATUSES.join(', ')}`);
    }
    ticket.status = status;
  }

  if (notes_by_team !== undefined) {
    ticket.notes_by_team = notes_by_team;
  }

  await ticket.save();

  // Notify the customer about the update.
  // We need their email — look up via customer_id.
  const User = require('../models/User');
  const customer = await User.findById(ticket.customer_id).select('email first_name push_tokens');
  if (customer) {
    notifyTicketUpdate(ticket, customer.email, customer.first_name, customer.push_tokens);
  }

  res.status(200).json({
    success: true,
    message: 'Ticket updated successfully',
    data: { ticket },
  });
});

/** DELETE /api/tickets/staff/:id — hard delete (admin only) */
exports.staffDeleteTicket = catchAsync(async (req, res) => {
  const ticket = await Ticket.findByIdAndDelete(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found');
  res.status(200).json({ success: true, message: 'Ticket deleted successfully' });
});
