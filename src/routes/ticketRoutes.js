const express = require('express');
const ticketController = require('../controllers/ticketController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

// All ticket routes require authentication.
router.use(authenticate);

// ── Staff routes BEFORE /:id so "staff" is not captured as a ticket id ────────
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

router.patch(
  '/staff/:id',
  authorize('admin', 'customer_support'),
  ticketController.staffUpdateTicket
);

router.delete(
  '/staff/:id',
  authorize('admin'),
  ticketController.staffDeleteTicket
);

// ── Customer routes ───────────────────────────────────────────────────────────
router.post('/', ticketController.createTicket);
router.get('/', ticketController.getMyTickets);
router.get('/:id', ticketController.getTicket);
router.patch('/:id', ticketController.updateTicket);

module.exports = router;
