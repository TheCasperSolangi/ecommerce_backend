const express = require('express');
const ticketController = require('../controllers/ticketController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

// All ticket routes require authentication.
router.use(authenticate);

// ── Customer routes ───────────────────────────────────────────────────────────
// Create a ticket — status is always forced to OPEN server-side.
router.post('/', ticketController.createTicket);

// View own tickets.
router.get('/', ticketController.getMyTickets);
router.get('/:id', ticketController.getTicket);

// Edit own ticket — only description/attachments, only while OPEN.
router.patch('/:id', ticketController.updateTicket);

// ── Staff routes (admin + customer_support) ───────────────────────────────────
// Separate /staff prefix keeps the permission boundary explicit.
// authorize ensures customers cannot reach these even if they guess the URL.
router.get(
  '/staff/all',
  authorize('admin', 'customer_support'),
  ticketController.staffGetAllTickets
);

router.get(
  '/staff/:id',
  authorize('admin', 'customer_support'),
  ticketController.staffGetTicket
);

// Status transitions (OPEN → UNDER_REVIEW → CLOSED) and team notes.
router.patch(
  '/staff/:id',
  authorize('admin', 'customer_support'),
  ticketController.staffUpdateTicket
);

// Hard delete — admin only.
router.delete(
  '/staff/:id',
  authorize('admin'),
  ticketController.staffDeleteTicket
);

module.exports = router;
