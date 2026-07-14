const express = require('express');
const categoryController = require('../controllers/categoryController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

// ── Public ────────────────────────────────────────────────────────────────────
// GET /api/categories                    — paginated / filtered list
// GET /api/categories/:idOrSlug          — single category
// GET /api/categories/:id/descendants    — full subtree of a category
router.get('/', categoryController.getAllCategories);
router.get('/:idOrSlug', categoryController.getCategory);
router.get('/:id/descendants', categoryController.getCategoryDescendants);

// ── Admin only ────────────────────────────────────────────────────────────────
router.use(authenticate, authorize('admin'));

router.post('/', categoryController.createCategory);
router.patch('/:id', categoryController.updateCategory);
router.delete('/:id', categoryController.deleteCategory);

module.exports = router;
