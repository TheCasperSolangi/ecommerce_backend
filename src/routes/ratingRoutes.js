const express = require('express');
const ratingController = require('../controllers/ratingController');
const authenticate = require('../middleware/authenticate');
const authorize    = require('../middleware/authorize');

const router = express.Router();

// ── Public — read reviews ─────────────────────────────────────────────────────
// GET /api/ratings/:productId   — paginated reviews for a product
router.get('/:productId', ratingController.getProductRatings);

// ── Authenticated — submit and edit ───────────────────────────────────────────
router.use(authenticate);

// POST /api/ratings             — create a review (verified purchase, delivered order)
router.post('/', ratingController.createRating);

// PATCH /api/ratings/:id        — edit own review (is_edited flagged permanently)
router.patch('/:id', ratingController.updateRating);

// ── Admin only ────────────────────────────────────────────────────────────────
// GET  /api/ratings/admin/all   — full list with filters
// DELETE /api/ratings/:id       — soft-delete a review
router.get('/admin/all', authorize('admin'), ratingController.adminGetAllRatings);
router.delete('/:id',    authorize('admin'), ratingController.adminDeleteRating);

module.exports = router;
