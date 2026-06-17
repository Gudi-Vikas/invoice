import express from 'express';
import vendorController from '../controllers/vendorController.js';
import { authenticateToken, requireTenant } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);
router.use(requireTenant);

router.post('/', vendorController.createVendor);
router.post('/:id/kyc', vendorController.submitKyc);
router.get('/', vendorController.getVendors);

export default router;
