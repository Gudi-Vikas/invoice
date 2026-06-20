import express from 'express';
import vendorController from '../controllers/vendorController.js';
import { authenticateToken, requireTenant, checkRole } from '../middleware/auth.js';

const router = express.Router();

// 1. Public redirect callback (invoked by Razorpay server authorization redirects)
router.get('/oauth/callback', vendorController.handleOAuthCallback);

// 2. Secured Tenant API routes
router.use(authenticateToken);
router.use(requireTenant);

router.post('/', vendorController.createVendor);
router.post('/:id/kyc', vendorController.submitKyc);
router.get('/', vendorController.getVendors);
router.get('/oauth/authorize', vendorController.getOAuthUrl);
router.get('/:id', vendorController.getVendorDetails);
router.get('/:id/balance', vendorController.getVendorBalance);
router.get('/:id/transfers', vendorController.getVendorTransfers);
router.post('/:id/payout', checkRole(['admin', 'billing']), vendorController.processVendorPayout);
router.delete('/:id', vendorController.deleteVendor);

export default router;
