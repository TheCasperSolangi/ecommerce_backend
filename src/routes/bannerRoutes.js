const express = require('express');
const bannerController = require('../controllers/bannerController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

const staffAccess = [authenticate, authorize('admin', 'marketing')];

// Staff list before /:id so "admin" is not captured as an id.
router.get('/admin/all', ...staffAccess, bannerController.adminGetAllBanners);

// Public storefront reads
router.get('/', bannerController.getAllBanners);
router.get('/:id', bannerController.getBanner);

// Admin / marketing write
router.post('/', ...staffAccess, bannerController.createBanner);
router.patch('/:id', ...staffAccess, bannerController.updateBanner);
router.delete('/:id', ...staffAccess, bannerController.deleteBanner);

module.exports = router;
