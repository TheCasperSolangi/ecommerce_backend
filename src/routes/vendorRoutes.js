const express = require('express');
const vendorController = require('../controllers/vendorController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

router.use(authenticate, authorize('admin'));

router.get('/', vendorController.getAllVendors);
router.get('/:id', vendorController.getVendor);
router.post('/', vendorController.createVendor);
router.patch('/:id', vendorController.updateVendor);
router.delete('/:id', vendorController.deleteVendor);

module.exports = router;
