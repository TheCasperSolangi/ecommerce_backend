const express = require('express');
const addressController = require('../controllers/addressController');
const authenticate = require('../middleware/authenticate');

const router = express.Router();

// All address routes require authentication.
router.use(authenticate);

router.get('/', addressController.getMyAddresses);
router.get('/:id', addressController.getAddress);
router.post('/', addressController.createAddress);
router.patch('/:id', addressController.updateAddress);
router.patch('/:id/set-default', addressController.setDefaultAddress);
router.delete('/:id', addressController.deleteAddress);

module.exports = router;
