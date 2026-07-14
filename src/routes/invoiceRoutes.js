const express = require('express');
const invoiceController = require('../controllers/invoiceController');
const authenticate = require('../middleware/authenticate');

const router = express.Router();

// Both endpoints require authentication.
// Access control (own order vs admin) is enforced inside the controller.
router.use(authenticate);

// Streams PDF as a file attachment — browser saves it to disk.
router.get('/:orderId/download', invoiceController.downloadInvoice);

// Streams PDF inline — open in browser tab, trigger window.print() on the frontend.
router.get('/:orderId/print', invoiceController.printInvoice);

module.exports = router;
