const express = require('express');
const productController = require('../controllers/productController');
const authenticate = require('../middleware/authenticate');
const optionalAuthenticate = require('../middleware/optionalAuthenticate');
const authorize = require('../middleware/authorize');
const warehouseScope = require('../middleware/warehouseScope');

const router = express.Router();

// Shorthand for the admin + warehouse scope chain used on every write/admin route.
const adminWarehouse = [authenticate, authorize('admin'), warehouseScope];

// ── Public (auth optional — logged-in admins also see draft/archived) ─────────
router.get('/', optionalAuthenticate, productController.getAllProducts);
router.get('/:idOrSlug', optionalAuthenticate, productController.getProduct);

// ── Admin only — product CRUD ─────────────────────────────────────────────────
router.post('/', adminWarehouse, productController.createProduct);
router.patch('/:id', adminWarehouse, productController.updateProduct);
router.delete('/:id', adminWarehouse, productController.deleteProduct);

// ── Admin only — variant management ──────────────────────────────────────────
router.post('/:id/variants', adminWarehouse, productController.addVariant);
router.patch('/:id/variants/:variantId', adminWarehouse, productController.updateVariant);
router.delete('/:id/variants/:variantId', adminWarehouse, productController.deleteVariant);

// ── Admin only — stock management ────────────────────────────────────────────
router.patch('/:id/variants/:variantId/stock', adminWarehouse, productController.updateStock);

module.exports = router;
