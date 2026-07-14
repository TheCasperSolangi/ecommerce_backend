const express = require('express');
const bannerController = require('../controllers/bannerController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

// ── Public — storefront reads active banners ──────────────────────────────────
// GET /api/banners              — active banners, optional ?type= filter
// GET /api/banners/:id          — single banner
router.get('/', bannerController.getAllBanners);
router.get('/:id', bannerController.getBanner);

// ── Admin / Marketing — full management ───────────────────────────────────────
// All write routes + the admin list endpoint require authentication and
// either admin or marketing role.
const staffAccess = [authenticate, authorize('admin', 'marketing')];

// Admin list — includes inactive banners with pagination.
router.get('/admin/all', ...staffAccess, bannerController.adminGetAllBanners);

// Create, update, delete.
router.post('/',    ...staffAccess, bannerController.createBanner);
router.patch('/:id', ...staffAccess, bannerController.updateBanner);
router.delete('/:id', ...staffAccess, bannerController.deleteBanner);

module.exports = router;
