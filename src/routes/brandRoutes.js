const express = require('express');
const brandController = require('../controllers/brandController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

// ── Public ────────────────────────────────────────────────────────────────────
// GET /api/brands          — paginated list with optional filters
// GET /api/brands/:idOrSlug — single brand by Mongo id or slug
router.get('/', brandController.getAllBrands);
router.get('/:idOrSlug', brandController.getBrand);

// ── Admin only ────────────────────────────────────────────────────────────────
router.use(authenticate, authorize('admin'));

router.post('/', brandController.createBrand);
router.patch('/:id', brandController.updateBrand);
router.delete('/:id', brandController.deleteBrand);

module.exports = router;
