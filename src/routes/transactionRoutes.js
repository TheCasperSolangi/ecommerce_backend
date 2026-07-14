const express = require('express');
const transactionController = require('../controllers/transactionController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

// All transaction routes — admin only.
// Transactions are financial records and must never be exposed to customers.
router.use(authenticate, authorize('admin'));

// ── Read ──────────────────────────────────────────────────────────────────────
// GET  /api/transactions           — paginated list with filters + summary totals
// GET  /api/transactions/:id       — single transaction detail
router.get('/', transactionController.getAllTransactions);
router.get('/:id', transactionController.getTransaction);

// ── Create (manual bookkeeping entries) ───────────────────────────────────────
// POST /api/transactions           — record an INCOME or EXPENSE entry manually
router.post('/', transactionController.createTransaction);

// ── Update (metadata only — amount/type are immutable) ───────────────────────
// PATCH /api/transactions/:id      — edit title and notes only
router.patch('/:id', transactionController.updateTransaction);

// ── DELETE is intentionally absent ───────────────────────────────────────────
// Financial records form an immutable audit trail and must never be deleted.
// Issue a counter-entry transaction to reverse an incorrect entry.

module.exports = router;
